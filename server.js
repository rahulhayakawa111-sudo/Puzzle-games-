const http = require("http");
const express = require("express");
const WebSocket = require("ws");

const app = express();
app.use(express.static("."));

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();

const MODES = {
    "1v1": { maxPlayers: 2, teamSize: 1 },
    "2v2": { maxPlayers: 4, teamSize: 2 },
    "4v4": { maxPlayers: 8, teamSize: 4 }
};

const QUESTIONS = [
    {
        question: "What has keys but cannot open locks?",
        options: ["Piano", "Door", "Car", "Clock"],
            answer: 0,
    },
    {
        question: "What has a face and two hands but no arms or legs?",
        options: ["Clock", "Robot", "Chair", "Book"],
            answer: 1,
    },
    {
        question: "What gets wetter the more it dries?",
        options: ["Towel", "Sponge", "Rain", "Soap"],
            answer: 2,
    },
    {
        question: "What has many teeth but cannot bite?",
        options: ["Comb", "Dog", "Shark", "Fork"],
            answer: 3,
    },
    {
        question: "What can travel around the world while staying in one corner?",
        options: ["Stamp", "Plane", "Sun", "Cloud"],
            answer: 0,
    },
    {
        question: "What has a neck but no head?",
        options: ["Bottle", "Shirt", "Snake", "Tree"],
            answer: 1,
    },
    {
        question: "What has one eye but cannot see?",
        options: ["Needle", "Camera", "Potato", "Storm"],
            answer: 2,
    },
    {
        question: "What comes down but never goes up?",
        options: ["Rain", "Ball", "Smoke", "Bird"],
            answer: 3,
    },
    {
        question: "What has hands but cannot clap?",
        options: ["Clock", "Person", "Glove", "Tree"],
            answer: 1,
    },
    {
        question: "What has words but never speaks?",
        options: ["Book", "Radio", "Phone", "Person"],
            answer: 2,
    }
];

function roomCode() {
    let code;

    do {
        code = Math.floor(
            100000 + Math.random() * 900000
        ).toString();
    } while (rooms.has(code));

    return code;
}

function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcast(room, data) {
    for (const player of room.players) {
        send(player.ws, data);
    }
}

function getTeam(room, index) {
    const config = MODES[room.mode];

    return index < config.teamSize ? "A" : "B";
}

function roomInfo(room) {
    return room.players.map((player, index) => ({
        id: player.id,
        name: player.name,
        team: getTeam(room, index)
    }));
}

function sendRoomInfo(room) {
    broadcast(room, {
        type: "room_info",
        room: room.code,
        mode: room.mode,
        maxPlayers: MODES[room.mode].maxPlayers,
        players: roomInfo(room),
        started: room.started
    });
}

function getScores(room) {
    const scores = {};

    for (const player of room.players) {
        scores[player.id] = room.scores[player.id] || 0;
    }

    return scores;
}

function sendQuestion(room) {
    if (!room.started) return;

    const q = QUESTIONS[room.level];

    if (!q) {
        broadcast(room, {
            type: "game_finished",
            scores: getScores(room)
        });

        room.started = false;
        return;
    }

    room.roundAnswered = new Set();
    room.roundWinner = null;

    broadcast(room, {
        type: "online_question",
        level: room.level + 1,
        totalLevels: QUESTIONS.length,
        question: q.question,
        options: q.options,
        scores: getScores(room),
        time: 30
    });

    clearTimeout(room.timer);

    room.timer = setTimeout(() => {
        if (!room.started) return;

        broadcast(room, {
            type: "question_timeout",
            correctAnswer: q.options[q.answer],
            scores: getScores(room)
        });

        setTimeout(() => {
            if (!room.started) return;

            room.level++;

            sendQuestion(room);
        }, 1200);

    }, 30000);
}

function startGame(room) {
    if (room.started) return;

    const config = MODES[room.mode];

    if (room.players.length < config.maxPlayers) {
        return;
    }

    room.started = true;
    room.level = 0;
    room.scores = {};
    room.roundAnswered = new Set();
    room.roundWinner = null;

    for (const player of room.players) {
        room.scores[player.id] = 0;
    }

    broadcast(room, {
        type: "game_started",
        mode: room.mode
    });

    sendQuestion(room);
}

wss.on("connection", (ws) => {

    const player = {
        ws,
        id: Math.random().toString(36).slice(2, 10),
        name: "Player",
        room: null
    };

    send(ws, {
        type: "connected",
        id: player.id
    });

    ws.on("message", (message) => {

        let data;

        try {
            data = JSON.parse(message.toString());
        } catch {
            return;
        }

        if (data.type === "create_room") {

            const mode = data.mode || "1v1";

            if (!MODES[mode]) return;

            const code = roomCode();

            const room = {
                code,
                mode,
                players: [],
                started: false,
                level: 0,
                scores: {},
                roundAnswered: new Set(),
                roundWinner: null,
                timer: null,
                hostId: player.id
            };

            player.name = String(data.name || "Player").slice(0, 20);
            player.room = code;

            room.players.push(player);

            rooms.set(code, room);

            send(ws, {
                type: "room_created",
                room: code,
                mode
            });

            sendRoomInfo(room);
        }

        else if (data.type === "join_room") {

            const code = String(data.room || "");
            const room = rooms.get(code);

            if (!room) {
                send(ws, {
                    type: "error",
                    message: "Room not found"
                });
                return;
            }

            if (room.started) {
                send(ws, {
                    type: "error",
                    message: "Game already started"
                });
                return;
            }

            const config = MODES[room.mode];

            if (room.players.length >= config.maxPlayers) {
                send(ws, {
                    type: "error",
                    message: "Room is full"
                });
                return;
            }

            player.name = String(data.name || "Player").slice(0, 20);
            player.room = code;

            room.players.push(player);

            send(ws, {
                type: "joined_room",
                room: code,
                mode: room.mode
            });

            sendRoomInfo(room);
        }

        else if (data.type === "start_game") {

            if (!player.room) return;

            const room = rooms.get(player.room);

            if (!room) return;

            if (room.hostId !== player.id) {
                send(ws, {
                    type: "error",
                    message: "Only room host can start the game"
                });
                return;
            }

            startGame(room);
        }

        else if (data.type === "answer") {

            if (!player.room) return;

            const room = rooms.get(player.room);

            if (!room || !room.started) return;

            if (room.roundWinner) return;

            if (room.roundAnswered.has(player.id)) return;

            const option = Number(data.option);

            if (!Number.isInteger(option)) return;

            if (option < 0 || option >= 4) return;

            const q = QUESTIONS[room.level];

            room.roundAnswered.add(player.id);

            if (option === q.answer) {

                room.roundWinner = player.id;

                room.scores[player.id] =
                    (room.scores[player.id] || 0) + 10;

                clearTimeout(room.timer);

                broadcast(room, {
                    type: "answer_result",
                    correct: true,
                    winner: player.name,
                    correctAnswer: q.options[q.answer],
                    scores: getScores(room)
                });

                setTimeout(() => {

                    if (!room.started) return;

                    room.level++;

                    sendQuestion(room);

                }, 1200);

            } else {

                send(ws, {
                    type: "answer_result",
                    correct: false,
                    message: "Wrong answer!",
                    scores: getScores(room)
                });

                if (room.roundAnswered.size >= room.players.length) {

                    clearTimeout(room.timer);

                    broadcast(room, {
                        type: "question_timeout",
                        correctAnswer: q.options[q.answer],
                        scores: getScores(room)
                    });

                    setTimeout(() => {

                        if (!room.started) return;

                        room.level++;

                        sendQuestion(room);

                    }, 1200);
                }
            }
        }

        else if (data.type === "chat") {

            if (!player.room) return;

            const room = rooms.get(player.room);

            if (!room) return;

            broadcast(room, {
                type: "chat",
                name: player.name,
                message: String(data.message || "").slice(0, 200)
            });
        }
    });

    ws.on("close", () => {

        if (!player.room) return;

        const room = rooms.get(player.room);

        if (!room) return;

        room.players = room.players.filter(
            p => p.id !== player.id
        );

        if (room.players.length === 0) {

            clearTimeout(room.timer);

            rooms.delete(room.code);

            return;
        }

        if (room.hostId === player.id) {
            room.hostId = room.players[0].id;
        }

        sendRoomInfo(room);
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(
        `🎮 Puzzle server running on port ${PORT}`
    );
});
