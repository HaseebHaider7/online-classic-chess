# Online Classic 3D Chess

Room-based online chess where users can choose to play against AI or against another player.
Players can join from different devices in real time.

## Features

- Live multiplayer over Socket.IO
- AI mode with challengeable rooms
- Room codes (share a room code with friends)
- Public list of AI rooms so others can request to join as opponent
- Full legal move validation on server with `chess.js`
- Classic black/white pieces and 3D-styled board
- Board coordinates (files/ranks)
- Color-based board orientation (black side sees black at bottom)
- Mobile-responsive board layout
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
