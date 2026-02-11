# Online Classic 3D Chess

Room-based online chess where two players can join from different devices and play in real time.
Extra users in the same room become spectators.

## Features

- Live multiplayer over Socket.IO
- Room codes (share a room code with friends)
- Full legal move validation on server with `chess.js`
- Classic black/white pieces and 3D-styled board
- Spectator support

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Start server:

```bash
npm start
```

3. Open in browser:

```text
http://localhost:3000
```

Open that URL on another device (same network) and join the same room code.

## Deploy (Render - Free)

1. Push this folder to a GitHub repository.
2. Go to https://render.com and create a **Web Service**.
3. Connect the repository.
4. Use:
- Build Command: `npm install`
- Start Command: `npm start`

Render will provide a public URL such as:

```text
https://your-chess-app.onrender.com
```

Share that URL. Players can join from anywhere.
