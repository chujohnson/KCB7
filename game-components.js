// ========================================
// KING CHU BRIDGE - EXTRACTED GAME COMPONENTS
// ========================================
// These components should be integrated into the server and client
// after the basic connectivity is tested and working.

// ========================================
// 1. GAME RULES ENGINE
// ========================================

const GAME_RULES = {
    MAX_ROUNDS: 13,
    MAX_PLAYERS: 4,
    
    // Scoring system - CONFIRMED FORMULA
    calculateScore: function(bid, tricksWon) {
        if (bid === tricksWon) {
            return 10 + (bid * bid);  // Exact: 10 + bid²
        } else {
            const difference = Math.abs(bid - tricksWon);
            return -(difference * difference);  // Miss: -(difference)²
        }
    },
    
    // Bidding rules
    getForbiddenBid: function(currentBids, round) {
        const totalCurrentBids = currentBids.reduce((sum, bid) => sum + (bid || 0), 0);
        const remainingPlayers = 4 - currentBids.filter(bid => bid !== null).length;
        
        if (remainingPlayers === 1) {
            const forbiddenValue = round - totalCurrentBids;
            return (forbiddenValue >= 0 && forbiddenValue <= round) ? forbiddenValue : -1;
        }
        return -1;
    },
    
    // Card playing rules
    isCardPlayable: function(card, playerHand, leadSuit) {
        if (!leadSuit) return true; // First card of trick
        if (card.suit === leadSuit) return true; // Following suit
        
        // Check if player has cards of lead suit
        const hasLeadSuit = playerHand.some(c => c.suit === leadSuit);
        return !hasLeadSuit; // Can play any card if can't follow suit
    }
};

// ========================================
// 2. CARD SYSTEM
// ========================================

const CARD_SYSTEM = {
    suits: ['♠', '♥', '♦', '♣'],
    values: ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'],
    
    createDeck: function() {
        const deck = [];
        this.suits.forEach(suit => {
            this.values.forEach(value => {
                deck.push({ 
                    suit, 
                    value, 
                    numValue: this.getCardValue(value) 
                });
            });
        });
        return this.shuffleDeck(deck);
    },
    
    shuffleDeck: function(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    },
    
    getCardValue: function(value) {
        switch (value) {
            case 'A': return 14;
            case 'K': return 13;
            case 'Q': return 12;
            case 'J': return 11;
            default: return parseInt(value);
        }
    },
    
    dealCards: function(round) {
        const deck = this.createDeck();
        const hands = [[], [], [], []];
        
        // Deal cards to each player
        for (let i = 0; i < round; i++) {
            for (let player = 0; player < 4; player++) {
                if (deck.length > 0) {
                    hands[player].push(deck.pop());
                }
            }
        }
        
        // Determine trump suit (except round 13)
        let trump = null;
        if (round === 13) {
            trump = null; // Dynamic trump in round 13
        } else if (deck.length > 0) {
            trump = deck[0].suit;
        } else {
            trump = this.suits[Math.floor(Math.random() * 4)];
        }
        
        return { hands, trump };
    }
};

// ========================================
// 3. TRICK SYSTEM
// ========================================

const TRICK_SYSTEM = {
    determineTrickWinner: function(trick, leadSuit, trump) {
        let winner = trick[0];
        let winningCard = trick[0].card;
        
        for (let i = 1; i < trick.length; i++) {
            const currentCard = trick[i].card;
            
            // Trump beats non-trump
            if (currentCard.suit === trump && winningCard.suit !== trump) {
                winner = trick[i];
                winningCard = currentCard;
            }
            // Higher trump beats lower trump
            else if (currentCard.suit === trump && winningCard.suit === trump) {
                if (currentCard.numValue > winningCard.numValue) {
                    winner = trick[i];
                    winningCard = currentCard;
                }
            }
            // Following suit: higher card wins (only if no trump involved)
            else if (currentCard.suit === leadSuit && winningCard.suit === leadSuit) {
                if (currentCard.numValue > winningCard.numValue) {
                    winner = trick[i];
                    winningCard = currentCard;
                }
            }
            // Following suit beats off-suit (when neither is trump)
            else if (currentCard.suit === leadSuit && winningCard.suit !== leadSuit && winningCard.suit !== trump) {
                winner = trick[i];
                winningCard = currentCard;
            }
        }
        
        return winner;
    }
};

// ========================================
// 4. SERVER GAME LOGIC (Insert into server.js)
// ========================================

const SERVER_GAME_LOGIC = `
// Add to gameState object:
round: 1,
currentPlayer: 0,
biddingStartPlayer: 0,
trump: null,
dynamicTrump: null,
currentTrick: [],
leadSuit: null,
playerHands: {},
scores: {},
bids: {},
tricksWon: {},
trickHistory: []

// Add to player object:
score: 0,
hand: [],
bid: null,
tricksWon: 0

// Game initialization function:
function initializeGameRules() {
    // Reset all game variables
    gameState.round = 1;
    gameState.currentPlayer = 0;
    gameState.biddingStartPlayer = Math.floor(Math.random() * 4);
    gameState.trump = null;
    gameState.dynamicTrump = null;
    gameState.currentTrick = [];
    gameState.leadSuit = null;
    gameState.playerHands = {};
    gameState.trickHistory = [];
    
    // Initialize player stats
    gameState.players.forEach(player => {
        gameState.scores[player.id] = 0;
        gameState.bids[player.id] = null;
        gameState.tricksWon[player.id] = 0;
        gameState.playerHands[player.id] = [];
    });
    
    // Deal first round
    dealFirstRound();
}

function dealFirstRound() {
    const deckData = CARD_SYSTEM.dealCards(gameState.round);
    
    // Assign hands to players
    gameState.players.forEach((player, index) => {
        gameState.playerHands[player.id] = deckData.hands[index];
    });
    
    gameState.trump = deckData.trump;
    gameState.phase = 'bidding';
    gameState.currentPlayer = gameState.biddingStartPlayer;
    
    broadcastChat('system', \`Round \${gameState.round} - Trump: \${gameState.trump || 'Dynamic'}\`);
    broadcastGameState();
}

function handleBid(ws, data) {
    const player = gameState.players.find(p => p.id === ws.playerId);
    if (!player || gameState.currentPlayer !== player.index) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not your turn to bid' }));
        return;
    }
    
    const bid = data.amount;
    if (bid < 0 || bid > gameState.round) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid bid amount' }));
        return;
    }
    
    // Check forbidden bid
    const currentBids = gameState.players.map(p => gameState.bids[p.id]);
    const forbiddenBid = GAME_RULES.getForbiddenBid(currentBids, gameState.round);
    if (bid === forbiddenBid && forbiddenBid !== -1) {
        ws.send(JSON.stringify({ type: 'error', message: 'Bid not allowed - total would equal cards dealt' }));
        return;
    }
    
    gameState.bids[player.id] = bid;
    broadcastChat('system', \`\${player.name} bids \${bid}\`);
    
    // Check if all bids complete
    const totalBids = Object.values(gameState.bids).filter(b => b !== null).length;
    if (totalBids >= 4) {
        gameState.phase = 'playing';
        gameState.currentPlayer = gameState.biddingStartPlayer;
        broadcastChat('system', 'All bids complete! Playing phase begins.');
    } else {
        gameState.currentPlayer = (gameState.currentPlayer + 1) % 4;
    }
    
    broadcastGameState();
}

function handlePlayCard(ws, data) {
    const player = gameState.players.find(p => p.id === ws.playerId);
    if (!player || gameState.currentPlayer !== player.index) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not your turn to play' }));
        return;
    }
    
    const card = data.card;
    const playerHand = gameState.playerHands[player.id];
    
    if (!GAME_RULES.isCardPlayable(card, playerHand, gameState.leadSuit)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Cannot play this card - must follow suit' }));
        return;
    }
    
    // Remove card from player's hand
    gameState.playerHands[player.id] = playerHand.filter(c => 
        !(c.suit === card.suit && c.value === card.value)
    );
    
    // Add to current trick
    gameState.currentTrick.push({
        card: card,
        playerId: player.id,
        playerName: player.name,
        playerIndex: player.index
    });
    
    // Set lead suit for first card
    if (gameState.currentTrick.length === 1) {
        gameState.leadSuit = card.suit;
        if (gameState.round === 13) {
            gameState.dynamicTrump = card.suit;
        }
    }
    
    broadcastChat('system', \`\${player.name} plays \${card.value}\${card.suit}\`);
    
    if (gameState.currentTrick.length === 4) {
        completeTrick();
    } else {
        gameState.currentPlayer = (gameState.currentPlayer + 1) % 4;
    }
    
    broadcastGameState();
}

function completeTrick() {
    const trump = gameState.dynamicTrump || gameState.trump;
    const winner = TRICK_SYSTEM.determineTrickWinner(gameState.currentTrick, gameState.leadSuit, trump);
    
    gameState.tricksWon[winner.playerId]++;
    gameState.trickHistory.push({
        cards: [...gameState.currentTrick],
        winner: winner,
        leadSuit: gameState.leadSuit,
        trump: trump
    });
    
    broadcastChat('system', \`\${winner.playerName} wins the trick!\`);
    
    // Clear trick
    gameState.currentTrick = [];
    gameState.leadSuit = null;
    gameState.dynamicTrump = null;
    gameState.currentPlayer = winner.playerIndex;
    
    // Check if round complete
    const allHandsEmpty = gameState.players.every(player => 
        gameState.playerHands[player.id].length === 0
    );
    
    if (allHandsEmpty) {
        completeRound();
    } else {
        broadcastGameState();
    }
}

function completeRound() {
    // Calculate scores
    gameState.players.forEach(player => {
        const bid = gameState.bids[player.id] || 0;
        const tricks = gameState.tricksWon[player.id] || 0;
        const roundScore = GAME_RULES.calculateScore(bid, tricks);
        gameState.scores[player.id] += roundScore;
        
        broadcastChat('system', \`\${player.name}: \${roundScore} points (Total: \${gameState.scores[player.id]})\`);
    });
    
    if (gameState.round >= 13) {
        completeGame();
    } else {
        // Next round
        gameState.round++;
        gameState.biddingStartPlayer = (gameState.biddingStartPlayer + 1) % 4;
        
        // Reset round variables
        gameState.players.forEach(player => {
            gameState.bids[player.id] = null;
            gameState.tricksWon[player.id] = 0;
        });
        
        dealFirstRound();
    }
}

function completeGame() {
    gameState.phase = 'game_complete';
    
    const maxScore = Math.max(...Object.values(gameState.scores));
    const winners = gameState.players.filter(player => gameState.scores[player.id] === maxScore);
    
    if (winners.length === 1) {
        broadcastChat('system', \`🏆 \${winners[0].name} wins with \${maxScore} points!\`);
    } else {
        const winnerNames = winners.map(w => w.name).join(' and ');
        broadcastChat('system', \`🏆 Tie between \${winnerNames} with \${maxScore} points!\`);
    }
    
    broadcastGameState();
}
`;

// ========================================
// 5. CLIENT GAME UI (Insert into client.html)
// ========================================

const CLIENT_GAME_UI = `
// Add to CSS:
.trump-display {
    background: linear-gradient(135deg, #ff6b6b, #ee5a52);
    color: white;
    padding: 15px;
    border-radius: 10px;
    text-align: center;
    font-size: 1.2em;
    font-weight: bold;
    margin: 10px 0;
}

.bidding-area {
    background: rgba(255, 193, 7, 0.2);
    border: 2px solid rgba(255, 193, 7, 0.8);
    border-radius: 10px;
    padding: 15px;
    margin: 10px 0;
}

.bid-buttons {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: center;
    margin-top: 10px;
}

.bid-btn {
    padding: 8px 15px;
    border: none;
    border-radius: 20px;
    background: #fff;
    border: 2px solid #ddd;
    cursor: pointer;
    font-weight: bold;
    transition: all 0.3s ease;
}

.bid-btn:hover {
    background: #f0f0f0;
    transform: translateY(-2px);
}

.bid-btn.forbidden {
    background: #e74c3c;
    color: white;
    cursor: not-allowed;
}

.player-hand {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: center;
    margin: 20px 0;
    padding: 15px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 10px;
}

.card {
    width: 60px;
    height: 80px;
    background: white;
    border: 2px solid #ddd;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    transition: all 0.3s ease;
    font-weight: bold;
}

.card:hover {
    transform: translateY(-5px);
    box-shadow: 0 5px 15px rgba(0,0,0,0.3);
}

.card.red { color: #e74c3c; }
.card.black { color: #2c3e50; }

.card.playable {
    border-color: #2ecc71;
    cursor: pointer;
}

.card.unplayable {
    opacity: 0.5;
    cursor: not-allowed;
}

.trick-area {
    background: rgba(255, 255, 255, 0.9);
    border-radius: 15px;
    padding: 20px;
    margin: 20px 0;
    text-align: center;
}

.trick-cards {
    display: flex;
    gap: 10px;
    justify-content: center;
    margin: 15px 0;
}

.score-board {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    padding: 15px;
    margin: 10px 0;
}

// Add to HTML in gameContent div:
<div id="trumpDisplay" class="trump-display" style="display: none;"></div>
<div id="biddingArea" class="bidding-area" style="display: none;"></div>
<div id="playerHand" class="player-hand"></div>
<div id="trickArea" class="trick-area">
    <h4>Current Trick</h4>
    <div id="trickCards" class="trick-cards"></div>
</div>
<div id="scoreBoard" class="score-board"></div>

// Add to JavaScript:
let myHand = [];
let currentPhase = 'waiting';

function handleDealCards(data) {
    myHand = data.hand;
    updatePlayerHand();
}

function handleBidUpdate(data) {
    // Update bidding display
    updateBiddingArea();
}

function handleCardPlayed(data) {
    // Update trick area
    updateTrickArea();
}

function makeBid(amount) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'bid',
            amount: amount
        }));
    }
}

function playCard(card) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'play_card',
            card: card
        }));
    }
}

function updateTrumpDisplay() {
    const trumpEl = document.getElementById('trumpDisplay');
    if (gameState && gameState.trump) {
        trumpEl.style.display = 'block';
        trumpEl.innerHTML = \`Trump: <span style="font-size: 2em;">\${gameState.trump}</span>\`;
    } else {
        trumpEl.style.display = 'none';
    }
}

function updatePlayerHand() {
    const handEl = document.getElementById('playerHand');
    handEl.innerHTML = '';
    
    myHand.forEach(card => {
        const cardEl = document.createElement('div');
        cardEl.className = \`card \${['♥', '♦'].includes(card.suit) ? 'red' : 'black'}\`;
        
        // Check if card is playable
        const isPlayable = GAME_RULES.isCardPlayable(card, myHand, gameState?.leadSuit);
        if (isPlayable && currentPhase === 'playing' && gameState?.currentPlayer === playerInfo.index) {
            cardEl.classList.add('playable');
            cardEl.onclick = () => playCard(card);
        } else {
            cardEl.classList.add('unplayable');
        }
        
        cardEl.innerHTML = \`
            <div>\${card.value}</div>
            <div>\${card.suit}</div>
        \`;
        
        handEl.appendChild(cardEl);
    });
}

function updateBiddingArea() {
    const biddingEl = document.getElementById('biddingArea');
    
    if (currentPhase === 'bidding' && gameState?.currentPlayer === playerInfo.index) {
        biddingEl.style.display = 'block';
        biddingEl.innerHTML = '<h4>Make Your Bid</h4><div class="bid-buttons"></div>';
        
        const buttonsEl = biddingEl.querySelector('.bid-buttons');
        const maxBid = gameState.round || 1;
        
        for (let i = 0; i <= maxBid; i++) {
            const btn = document.createElement('button');
            btn.className = 'bid-btn';
            btn.textContent = i;
            btn.onclick = () => makeBid(i);
            
            // Check if forbidden bid
            const currentBids = gameState.players.map(p => gameState.bids[p.id]);
            const forbiddenBid = GAME_RULES.getForbiddenBid(currentBids, gameState.round);
            if (i === forbiddenBid && forbiddenBid !== -1) {
                btn.classList.add('forbidden');
                btn.onclick = null;
            }
            
            buttonsEl.appendChild(btn);
        }
    } else {
        biddingEl.style.display = 'none';
    }
}

function updateTrickArea() {
    const trickCardsEl = document.getElementById('trickCards');
    trickCardsEl.innerHTML = '';
    
    if (gameState?.currentTrick) {
        gameState.currentTrick.forEach(cardData => {
            const cardEl = document.createElement('div');
            cardEl.className = \`card \${['♥', '♦'].includes(cardData.card.suit) ? 'red' : 'black'}\`;
            cardEl.innerHTML = \`
                <div>\${cardData.card.value}</div>
                <div>\${cardData.card.suit}</div>
            \`;
            cardEl.title = cardData.playerName;
            trickCardsEl.appendChild(cardEl);
        });
    }
}

function updateScoreBoard() {
    const scoreEl = document.getElementById('scoreBoard');
    
    if (gameState?.players) {
        let scoreHTML = '<h4>Scores</h4>';
        gameState.players.forEach(player => {
            const score = gameState.scores[player.id] || 0;
            const bid = gameState.bids[player.id] !== null ? gameState.bids[player.id] : '?';
            const tricks = gameState.tricksWon[player.id] || 0;
            
            scoreHTML += \`
                <div>\${player.name}: \${score} pts (Bid: \${bid}, Tricks: \${tricks})</div>
            \`;
        });
        scoreEl.innerHTML = scoreHTML;
    }
}
`;

// ========================================
// 6. INTEGRATION INSTRUCTIONS
// ========================================

console.log(`
========================================
INTEGRATION INSTRUCTIONS
========================================

1. TEST BASIC CONNECTIVITY FIRST:
   - Run: node server.js
   - Open: http://localhost:3000
   - Test with 4 players joining

2. ADD GAME COMPONENTS GRADUALLY:

   A) Add to server.js:
      - Copy GAME_RULES, CARD_SYSTEM, TRICK_SYSTEM objects
      - Add SERVER_GAME_LOGIC functions
      - Add message handlers for 'bid' and 'play_card'
      
   B) Add to client.html:
      - Add CSS styles from CLIENT_GAME_UI
      - Add HTML elements to gameContent div
      - Add JavaScript functions from CLIENT_GAME_UI
      - Add message handlers for game events

3. TESTING PHASES:
   - Phase 1: Basic connection (DONE)
   - Phase 2: Add card dealing and hand display
   - Phase 3: Add bidding system
   - Phase 4: Add card playing
   - Phase 5: Add scoring and rounds
   - Phase 6: Add all original game features

4. MARKED LOCATIONS:
   - All TODO comments show where to insert components
   - Search for "TODO: INSERT" in both files

5. DEPENDENCIES:
   - Server needs: ws (npm install ws)
   - Client needs: Modern browser with WebSocket support

========================================
`);

module.exports = {
    GAME_RULES,
    CARD_SYSTEM,
    TRICK_SYSTEM,
    SERVER_GAME_LOGIC,
    CLIENT_GAME_UI
};