const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Server Configuration
const PORT = 3000;
const MAX_PLAYERS = 4;

// ========================================
// COMPLETE KING CHU BRIDGE GAME LOGIC
// ========================================

// Game Rules Engine
const GAME_RULES = {
    MAX_ROUNDS: 13,
    
    calculateScore: function(bid, tricksWon) {
        if (bid === tricksWon) {
            return 10 + (bid * bid);  // Exact: 10 + bid²
        } else {
            const difference = Math.abs(bid - tricksWon);
            return -(difference * difference);  // Miss: -(difference)²
        }
    },
    
    getForbiddenBid: function(currentBids, round) {
        const totalCurrentBids = currentBids.reduce((sum, bid) => sum + (bid || 0), 0);
        const remainingPlayers = 4 - currentBids.filter(bid => bid !== null && bid !== undefined).length;
        
        if (remainingPlayers === 1) {
            const forbiddenValue = round - totalCurrentBids;
            return (forbiddenValue >= 0 && forbiddenValue <= round) ? forbiddenValue : -1;
        }
        return -1;
    },
    
    isCardPlayable: function(card, playerHand, leadSuit) {
        if (!leadSuit) return true; // First card of trick
        if (card.suit === leadSuit) return true; // Following suit
        
        const hasLeadSuit = playerHand.some(c => c.suit === leadSuit);
        return !hasLeadSuit; // Can play any card if can't follow suit
    }
};

// Card System
const CARD_SYSTEM = {
    suits: ['\u2660', '\u2665', '\u2666', '\u2663'], // ♠♥♦♣
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
    }
};

// Trick System
const TRICK_SYSTEM = {
    determineTrickWinner: function(trick, leadSuit, trump) {
        let winner = trick[0];
        let winningCard = trick[0].card;
        
        for (let i = 1; i < trick.length; i++) {
            const currentCard = trick[i].card;
            
            if (currentCard.suit === trump && winningCard.suit !== trump) {
                winner = trick[i];
                winningCard = currentCard;
            }
            else if (currentCard.suit === trump && winningCard.suit === trump) {
                if (currentCard.numValue > winningCard.numValue) {
                    winner = trick[i];
                    winningCard = currentCard;
                }
            }
            else if (currentCard.suit === leadSuit && winningCard.suit === leadSuit) {
                if (currentCard.numValue > winningCard.numValue) {
                    winner = trick[i];
                    winningCard = currentCard;
                }
            }
            else if (currentCard.suit === leadSuit && winningCard.suit !== leadSuit && winningCard.suit !== trump) {
                winner = trick[i];
                winningCard = currentCard;
            }
        }
        
        return winner;
    }
};

// Complete Game State
let gameState = {
    players: [],
    gameStarted: false,
    hostId: null,
    phase: 'waiting', // waiting, bidding, playing, trick_winner_display, round_complete, game_complete
    round: 1,
    currentPlayer: 0,
    biddingStartPlayer: 0,
    roundStartPlayer: 0, // Player who starts bidding AND plays first card of FIRST TRICK only
    trump: null,
    dynamicTrump: null,
    currentTrick: [],
    leadSuit: null,
    playerHands: {},
    scores: {},
    bids: {},
    tricksWon: {},
    trickHistory: [],
    trickWinnerIndex: null,
    trickCountdown: 0,
    chatMessages: [],
    dealing: false,
    completingTrick: false,
    completingRound: false
};

// Connected clients
const clients = new Map();

// Create HTTP server
const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'client.html'), (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('Client file not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

console.log('🚀 King Chu Bridge Server Starting...');
console.log(`📡 Server will run on: http://localhost:${PORT}`);
console.log(`🌐 Other players can join via: http://[YOUR_IP]:${PORT}`);
console.log(`👥 Maximum players: ${MAX_PLAYERS}`);
console.log('🎮 First player to join becomes the host');

wss.on('connection', (ws) => {
    console.log('👤 New client connected');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (error) {
            console.error('❌ Invalid message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format'
            }));
        }
    });
    
    ws.on('close', () => {
        handleDisconnect(ws);
    });
    
    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        handleDisconnect(ws);
    });
});

function handleMessage(ws, data) {
    console.log(`📨 Received: ${data.type} from ${data.playerName || ws.playerId || 'unknown'}`);
    
    switch (data.type) {
        case 'join':
            handlePlayerJoin(ws, data);
            break;
            
        case 'start_game':
            handleStartGame(ws);
            break;
            
        case 'chat':
            handleChat(ws, data);
            break;
            
        case 'bid':
            handleBid(ws, data);
            break;
            
        case 'play_card':
            handlePlayCard(ws, data);
            break;
            
        case 'emoji':
            handleEmoji(ws, data);
            break;
            
        default:
            ws.send(JSON.stringify({
                type: 'error',
                message: `Unknown message type: ${data.type}`
            }));
    }
}

function handlePlayerJoin(ws, data) {
    const playerName = data.playerName?.trim();
    
    if (!playerName) {
        ws.send(JSON.stringify({ type: 'error', message: 'Player name is required' }));
        return;
    }
    
    if (gameState.players.length >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ type: 'error', message: 'Game is full (4 players maximum)' }));
        return;
    }
    
    if (gameState.gameStarted) {
        ws.send(JSON.stringify({ type: 'error', message: 'Game already in progress' }));
        return;
    }
    
    if (gameState.players.some(p => p.name === playerName)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Player name already taken' }));
        return;
    }
    
    const playerId = generatePlayerId();
    const player = {
        id: playerId,
        name: playerName,
        index: gameState.players.length,
        isHost: gameState.players.length === 0,
        connected: true
    };
    
    if (gameState.players.length === 0) {
        gameState.hostId = playerId;
        console.log(`👑 ${playerName} is now the host`);
    }
    
    gameState.players.push(player);
    clients.set(playerId, ws);
    ws.playerId = playerId;
    
    console.log(`✅ ${playerName} joined as player ${player.index + 1} (${gameState.players.length}/${MAX_PLAYERS})`);
    
    ws.send(JSON.stringify({
        type: 'join_success',
        playerId: playerId,
        playerIndex: player.index,
        isHost: player.isHost
    }));
    
    broadcastGameState();
    broadcastChat('system', `${playerName} joined the game! (${gameState.players.length}/${MAX_PLAYERS})`);
}

function handleStartGame(ws) {
    const player = gameState.players.find(p => p.id === ws.playerId);
    
    if (!player || !player.isHost) {
        ws.send(JSON.stringify({ type: 'error', message: 'Only the host can start the game' }));
        return;
    }
    
    if (gameState.players.length < MAX_PLAYERS) {
        ws.send(JSON.stringify({ type: 'error', message: `Need ${MAX_PLAYERS} players to start (currently ${gameState.players.length})` }));
        return;
    }
    
    if (gameState.gameStarted) {
        ws.send(JSON.stringify({ type: 'error', message: 'Game already started' }));
        return;
    }
    
    initializeGame();
}

function initializeGame() {
    gameState.gameStarted = true;
    gameState.round = 1;
    
    // More robust random selection with multiple attempts if needed
    let attempts = 0;
    let selectedPlayerIndex;
    
    do {
        const randomValue = Math.random();
        selectedPlayerIndex = Math.floor(randomValue * 4);
        attempts++;
        
        console.log(`🎲 Random attempt ${attempts}:`);
        console.log(`   Math.random(): ${randomValue}`);
        console.log(`   Result: ${selectedPlayerIndex}`);
        
        // Force different result if we keep getting 0 (shouldn't be necessary, but just in case)
        if (attempts > 1 && selectedPlayerIndex === 0) {
            selectedPlayerIndex = Date.now() % 4; // Use timestamp as fallback
            console.log(`   🔄 Fallback to timestamp method: ${selectedPlayerIndex}`);
            break;
        }
    } while (attempts < 2); // Only try twice max
    
    gameState.roundStartPlayer = selectedPlayerIndex;
    gameState.biddingStartPlayer = gameState.roundStartPlayer;
    gameState.currentPlayer = gameState.roundStartPlayer;
    
    // Additional verification
    const selectedPlayer = gameState.players[gameState.roundStartPlayer];
    console.log(`🎯 Selected first bidder: Player ${gameState.roundStartPlayer} (${selectedPlayer.name})`);
    
    // Initialize player data
    gameState.players.forEach(player => {
        gameState.scores[player.id] = 0;
        gameState.bids[player.id] = null;
        gameState.tricksWon[player.id] = 0;
        gameState.playerHands[player.id] = [];
    });
    
    console.log('🎮 Game initialized - dealing first round');
    dealCards();
    
    broadcastChat('system', '🎮 Game started! Good luck everyone!');
}


function dealCards() {
    if (gameState.dealing) return;
    gameState.dealing = true;
    
    console.log(`🎴 Dealing round ${gameState.round}`);
    
    // Clear previous round data
    gameState.currentTrick = [];
    gameState.leadSuit = null;
    gameState.dynamicTrump = null;
    gameState.trickWinnerIndex = null;
    gameState.trickCountdown = 0;
    gameState.phase = 'dealing';
    
    gameState.players.forEach(player => {
        gameState.bids[player.id] = null;
        gameState.tricksWon[player.id] = 0;
    });
    
    // Deal cards
    const deck = CARD_SYSTEM.createDeck();
    const cardsPerPlayer = gameState.round;
    
    gameState.players.forEach(player => {
        gameState.playerHands[player.id] = [];
    });
    
    for (let i = 0; i < cardsPerPlayer; i++) {
        gameState.players.forEach(player => {
            if (deck.length > 0) {
                gameState.playerHands[player.id].push(deck.pop());
            }
        });
    }
    
    // Set trump
    if (gameState.round === 13) {
        gameState.trump = null;
        broadcastChat('system', '🌟 Round 13: Dynamic trump - changes each trick!');
    } else if (deck.length > 0) {
        gameState.trump = deck[0].suit;
        broadcastChat('system', `Trump suit: ${gameState.trump}`);
    } else {
        gameState.trump = CARD_SYSTEM.suits[Math.floor(Math.random() * 4)];
        broadcastChat('system', `Trump suit: ${gameState.trump}`);
    }
    
    // Start bidding - ensure currentPlayer is set to roundStartPlayer
    gameState.phase = 'bidding';
    gameState.currentPlayer = gameState.roundStartPlayer;
    gameState.dealing = false;
    
    const firstBidder = gameState.players[gameState.roundStartPlayer].name;
    const playerLetter = String.fromCharCode(65 + gameState.roundStartPlayer); // A=65, B=66, C=67, D=68
    broadcastChat('system', `🎴 Round ${gameState.round} - Player ${playerLetter} (${firstBidder}) bids first and will lead the first trick!`);
    
    broadcastGameState();
}

function handleBid(ws, data) {
    const player = gameState.players.find(p => p.id === ws.playerId);
    
    if (!player || gameState.currentPlayer !== player.index) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not your turn to bid!' }));
        return;
    }
    
    if (gameState.phase !== 'bidding') {
        ws.send(JSON.stringify({ type: 'error', message: 'Bidding phase is over!' }));
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
        ws.send(JSON.stringify({ type: 'error', message: `Cannot bid ${bid} - total would equal ${gameState.round} cards!` }));
        return;
    }
    
    if (gameState.bids[player.id] !== null) {
        ws.send(JSON.stringify({ type: 'error', message: 'You have already placed your bid!' }));
        return;
    }
    
    gameState.bids[player.id] = bid;
    broadcastChat('system', `${player.name} bids ${bid} trick${bid !== 1 ? 's' : ''}`);
    
    const totalBids = Object.values(gameState.bids).filter(b => b !== null && b !== undefined).length;
    
    if (totalBids >= 4) {
        // All bids complete - move to playing phase
        gameState.phase = 'playing';
        // IMPORTANT: Set current player to the round start player for FIRST TRICK only
        gameState.currentPlayer = gameState.roundStartPlayer;
        
        const leader = gameState.players[gameState.roundStartPlayer].name;
        const playerLetter = String.fromCharCode(65 + gameState.roundStartPlayer);
        broadcastChat('system', `All bids complete! Player ${playerLetter} (${leader}) leads the first trick.`);
        
        if (gameState.round === 13) {
            broadcastChat('system', '🌟 Trump changes each trick to the suit of the first card!');
        }
    } else {
        let nextPlayerIndex = (gameState.currentPlayer + 1) % 4;
        while (gameState.bids[gameState.players[nextPlayerIndex].id] !== null) {
            nextPlayerIndex = (nextPlayerIndex + 1) % 4;
        }
        gameState.currentPlayer = nextPlayerIndex;
        const nextPlayerName = gameState.players[nextPlayerIndex].name;
        broadcastChat('system', `${nextPlayerName}'s turn to bid...`);
    }
    
    broadcastGameState();
}

function handlePlayCard(ws, data) {
    const player = gameState.players.find(p => p.id === ws.playerId);
    
    if (!player || gameState.currentPlayer !== player.index) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not your turn to play!' }));
        return;
    }
    
    if (gameState.phase !== 'playing') {
        ws.send(JSON.stringify({ type: 'error', message: 'Not in playing phase!' }));
        return;
    }
    
    const card = data.card;
    const playerHand = gameState.playerHands[player.id];
    
    if (!GAME_RULES.isCardPlayable(card, playerHand, gameState.leadSuit)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Cannot play this card - must follow suit if possible!' }));
        return;
    }
    
    // Remove card from hand
    gameState.playerHands[player.id] = playerHand.filter(c => 
        !(c.suit === card.suit && c.value === card.value)
    );
    
    // Add to trick
    gameState.currentTrick.push({
        card: card,
        playerId: player.id,
        playerName: player.name,
        playerIndex: player.index
    });
    
    // Set lead suit for first card of trick
    if (gameState.currentTrick.length === 1) {
        gameState.leadSuit = card.suit;
        if (gameState.round === 13) {
            gameState.dynamicTrump = card.suit;
        }
    }
    
    broadcastChat('player', `${player.name} plays ${card.value}${card.suit}`);
    
    if (gameState.currentTrick.length === 4) {
        setTimeout(() => completeTrick(), 100);
    } else {
        gameState.currentPlayer = (gameState.currentPlayer + 1) % 4;
        const nextPlayerName = gameState.players[gameState.currentPlayer].name;
        broadcastChat('system', `${nextPlayerName}'s turn to play...`);
    }
    
    broadcastGameState();
}

function completeTrick() {
    if (gameState.completingTrick || gameState.currentTrick.length < 4) return;
    gameState.completingTrick = true;
    
    const trump = gameState.dynamicTrump || gameState.trump;
    const winner = TRICK_SYSTEM.determineTrickWinner(gameState.currentTrick, gameState.leadSuit, trump);
    
    gameState.tricksWon[winner.playerId]++;
    gameState.trickWinnerIndex = winner.playerIndex;
    gameState.phase = 'trick_winner_display';
    gameState.trickCountdown = 3;
    
    if (!gameState.trickHistory) gameState.trickHistory = [];
    gameState.trickHistory.push({
        cards: [...gameState.currentTrick],
        winner: winner,
        leadSuit: gameState.leadSuit,
        trump: trump
    });
    
    broadcastChat('system', `${winner.playerName} wins the trick! 🏆`);
    broadcastGameState();
    
    // Start countdown
    startTrickCountdown(winner);
}

function startTrickCountdown(winner) {
    const countdownTimer = setInterval(() => {
        gameState.trickCountdown--;
        
        if (gameState.trickCountdown <= 0) {
            clearInterval(countdownTimer);
            clearTrick(winner);
        }
        
        broadcastGameState();
    }, 1000);
}

function clearTrick(winner) {
    gameState.currentTrick = [];
    gameState.leadSuit = null;
    gameState.dynamicTrump = null;
    gameState.trickWinnerIndex = null;
    gameState.trickCountdown = 0;
    gameState.completingTrick = false;
    gameState.phase = 'playing';
    // Winner of previous trick leads the next trick (normal bridge rule)
    gameState.currentPlayer = winner.playerIndex;
    
    // Check if round complete
    const allHandsEmpty = gameState.players.every(player => 
        gameState.playerHands[player.id].length === 0
    );
    
    if (allHandsEmpty) {
        completeRound();
    } else {
        const nextLeader = gameState.players[gameState.currentPlayer].name;
        broadcastChat('system', `${nextLeader} leads the next trick!`);
        broadcastGameState();
    }
}

function completeRound() {
    if (gameState.completingRound) return;
    gameState.completingRound = true;
    
    gameState.phase = 'round_complete';
    
    // Calculate scores
    const roundScores = {};
    gameState.players.forEach(player => {
        const bid = gameState.bids[player.id] || 0;
        const tricks = gameState.tricksWon[player.id] || 0;
        const roundScore = GAME_RULES.calculateScore(bid, tricks);
        roundScores[player.id] = roundScore;
        
        const oldScore = gameState.scores[player.id] || 0;
        gameState.scores[player.id] = oldScore + roundScore;
    });
    
    // Broadcast results
    let resultMessage = `📊 Round ${gameState.round} Complete`;
    const sortedPlayers = [...gameState.players].sort((a, b) => roundScores[b.id] - roundScores[a.id]);
    
    sortedPlayers.forEach(player => {
        const bid = gameState.bids[player.id] || 0;
        const tricks = gameState.tricksWon[player.id] || 0;
        const roundScore = roundScores[player.id];
        const totalScore = gameState.scores[player.id];
        
        const bidStatus = bid === tricks ? '✅' : '❌';
        const scoreSymbol = roundScore >= 0 ? '+' : '';
        
        resultMessage += `\n${bidStatus} ${player.name}: ${scoreSymbol}${roundScore} pts (Total: ${totalScore})`;
    });
    
    broadcastChat('system', resultMessage);
    broadcastGameState();
    
    if (gameState.round >= 13) {
        setTimeout(() => completeGame(), 2000);
    } else {
        setTimeout(() => {
            gameState.round++;
            // FIXED: Continue rotation from previous round instead of resetting
            gameState.roundStartPlayer = (gameState.roundStartPlayer + 1) % 4;
            gameState.biddingStartPlayer = gameState.roundStartPlayer;
            gameState.completingRound = false;
            dealCards();
        }, 3000);
    }
}

function completeGame() {
    gameState.phase = 'game_complete';
    
    const maxScore = Math.max(...Object.values(gameState.scores));
    const winners = gameState.players.filter(player => gameState.scores[player.id] === maxScore);
    
    let winnerMessage;
    if (winners.length === 1) {
        winnerMessage = `🏆 ${winners[0].name} wins with ${maxScore} points!`;
    } else {
        const winnerNames = winners.map(w => w.name).join(' and ');
        winnerMessage = `🏆 Tie between ${winnerNames} with ${maxScore} points!`;
    }
    
    // Final scores
    const sortedPlayers = gameState.players.sort((a, b) => gameState.scores[b.id] - gameState.scores[a.id]);
    let finalMessage = `🏅 FINAL RANKINGS:\n`;
    sortedPlayers.forEach((player, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '4️⃣';
        const rank = index + 1;
        const score = gameState.scores[player.id];
        finalMessage += `${medal} #${rank}: ${player.name} - ${score} points\n`;
    });
    
    broadcastChat('system', winnerMessage);
    broadcastChat('system', finalMessage);
    broadcastChat('system', '🎮 Thanks for playing King Chu Bridge!');
    
    broadcastGameState();
}

function handleChat(ws, data) {
    const player = gameState.players.find(p => p.id === ws.playerId);
    if (!player) return;
    
    const message = data.message?.trim();
    if (!message) return;
    
    broadcastChat('player', `${player.name}: ${message}`);
}

function handleEmoji(ws, data) {
    const player = gameState.players.find(p => p.id === ws.playerId);
    if (!player) return;
    
    broadcastChat('player', `${player.name}: ${data.emoji}`);
}

function handleDisconnect(ws) {
    if (!ws.playerId) return;
    
    const player = gameState.players.find(p => p.id === ws.playerId);
    if (!player) return;
    
    console.log(`👋 ${player.name} disconnected`);
    
    if (gameState.gameStarted) {
        gameState.phase = 'ended';
        broadcastChat('system', `❌ ${player.name} disconnected. Game ended.`);
        broadcastGameState();
        
        setTimeout(() => resetGame(), 5000);
    } else {
        gameState.players = gameState.players.filter(p => p.id !== ws.playerId);
        
        if (player.isHost && gameState.players.length > 0) {
            gameState.players[0].isHost = true;
            gameState.hostId = gameState.players[0].id;
        }
        
        gameState.players.forEach((p, index) => { p.index = index; });
        
        broadcastChat('system', `${player.name} left the game. (${gameState.players.length}/${MAX_PLAYERS})`);
        broadcastGameState();
    }
    
    clients.delete(ws.playerId);
}

function broadcastGameState() {
    const message = JSON.stringify({
        type: 'game_state',
        gameState: {
            players: gameState.players,
            gameStarted: gameState.gameStarted,
            phase: gameState.phase,
            round: gameState.round,
            currentPlayer: gameState.currentPlayer,
            roundStartPlayer: gameState.roundStartPlayer,
            trump: gameState.trump,
            dynamicTrump: gameState.dynamicTrump,
            currentTrick: gameState.currentTrick,
            leadSuit: gameState.leadSuit,
            scores: gameState.scores,
            bids: gameState.bids,
            tricksWon: gameState.tricksWon,
            trickWinnerIndex: gameState.trickWinnerIndex,
            trickCountdown: gameState.trickCountdown,
            playerCount: gameState.players.length
        }
    });
    
    clients.forEach((ws, playerId) => {
        if (ws.readyState === WebSocket.OPEN) {
            // Send personalized hand data
            const personalizedMessage = JSON.parse(message);
            personalizedMessage.myHand = gameState.playerHands[playerId] || [];
            ws.send(JSON.stringify(personalizedMessage));
        }
    });
}

function broadcastChat(type, message) {
    const chatMessage = {
        type: type,
        message: message,
        timestamp: Date.now()
    };
    
    if (!gameState.chatMessages) gameState.chatMessages = [];
    gameState.chatMessages.push(chatMessage);
    
    const broadcastMessage = JSON.stringify({
        type: 'chat',
        messageType: type,
        message: message,
        timestamp: Date.now()
    });
    
    console.log(`💬 ${type}: ${message}`);
    
    clients.forEach((ws, playerId) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(broadcastMessage);
        }
    });
}

function resetGame() {
    console.log('🔄 Resetting game...');
    
    gameState = {
        players: [],
        gameStarted: false,
        hostId: null,
        phase: 'waiting',
        round: 1,
        currentPlayer: 0,
        biddingStartPlayer: 0,
        roundStartPlayer: 0,
        trump: null,
        dynamicTrump: null,
        currentTrick: [],
        leadSuit: null,
        playerHands: {},
        scores: {},
        bids: {},
        tricksWon: {},
        trickHistory: [],
        trickWinnerIndex: null,
        trickCountdown: 0,
        chatMessages: [],
        dealing: false,
        completingTrick: false,
        completingRound: false
    };
    
    clients.clear();
}

function generatePlayerId() {
    return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Start server
server.listen(PORT, () => {
    console.log('\n🎯 King Chu Bridge Server Running!');
    console.log(`🌐 Local access: http://localhost:${PORT}`);
    console.log(`🌐 Network access: http://[YOUR_IP]:${PORT}`);
    console.log('\n🎮 Ready for players!');
});

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});