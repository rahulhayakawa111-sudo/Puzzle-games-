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

function roomCode() {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
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

function roomInfo(room) {
    const config = MODES[room.mode];

    return room.players.map((p, index) => ({
        id: p.id,
        name: p.name,
        team: index < config.teamSize ? "A" : "B"
    }));
}

function sendRoomInfo(room) {
    broadcast(room, {
        type: "room_info",
        room: room.code,
        mode: room.mode,
        maxPlayers: MODES[room.mode].maxPlayers,
        players: roomInfo(room)
    });
}

wss.on("connection", (ws) => {

    const player = {
        ws,
        id: Math.random().toString(36).slice(2, 10),
        name: "Player",
        room: null
    };

    ws.on("message", (raw) => {

        let data;

        try {
            data = JSON.parse(raw);
        } catch {
            return send(ws, {
                type: "error",
                message: "Invalid message"
            });
        }

        if (data.type === "create") {

            if (player.room) {
                return send(ws, {
                    type: "error",
                    message: "You are already in a room"
                });
            }

            const mode = String(data.mode || "2v2");

            if (!MODES[mode]) {
                return send(ws, {
                    type: "error",
                    message: "Invalid game mode"
                });
            }

            const code = roomCode();

            const room = {
                code,
                mode,
                players: [],
                started: false
            };

            rooms.set(code, room);

            player.name = String(data.name || "Player").slice(0, 20);
            player.room = code;

            room.players.push(player);

            send(ws, {
                type: "room_created",
                room: code,
                mode,
                maxPlayers: MODES[mode].maxPlayers,
                playerId: player.id
            });

            sendRoomInfo(room);
        }

        else if (data.type === "join") {

            if (player.room) {
                return send(ws, {
                    type: "error",
                    message: "You are already in a room"
                });
            }

            const code = String(data.room || "").trim();
            const room = rooms.get(code);

            if (!room) {
                return send(ws, {
                    type: "error",
                    message: "Room not found"
                });
            }

            if (room.started) {
                return send(ws, {
                    type: "error",
                    message: "Game already started"
                });
            }

            const maxPlayers = MODES[room.mode].maxPlayers;

            if (room.players.length >= maxPlayers) {
                return send(ws, {
                    type: "error",
                    message: "Room is full"
                });
            }

            player.name = String(data.name || "Player").slice(0, 20);
            player.room = code;

            room.players.push(player);

            send(ws, {
                type: "joined",
                room: code,
                mode: room.mode,
                maxPlayers,
                playerId: player.id
            });

            sendRoomInfo(room);
        }

        else if (data.type === "chat") {

            if (!player.room) return;

            const room = rooms.get(player.room);
            if (!room) return;

            const message = String(data.message || "")
                .trim()
                .slice(0, 200);

            if (!message) return;

            broadcast(room, {
                type: "chat",
                player: player.name,
                message
            });
        }

        else if (data.type === "start") {

            if (!player.room) return;

            const room = rooms.get(player.room);
            if (!room) return;

            const config = MODES[room.mode];

            if (room.players.length < config.maxPlayers) {
                return send(ws, {
                    type: "error",
                    message:
                        `${room.mode} ke liye ${config.maxPlayers} players required hain`
                });
            }

            room.started = true;

            broadcast(room, {
                type: "game_start",
                mode: room.mode,
                players: roomInfo(room)
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
            rooms.delete(room.code);
        } else {
            sendRoomInfo(room);
        }
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`🎮 Puzzle server running on port ${PORT}`);
});
