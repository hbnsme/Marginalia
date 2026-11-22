# Marginalia Windows launcher

`start.vbs` and `close.vbs` use the standalone Node.js installation at `C:\Program Files\nodejs\node.exe` and keep console windows hidden.

- `start.vbs` starts the Vite server on `localhost:5173` and the translation proxy on `127.0.0.1:8788`, waits for both health checks, then opens the default browser at the existing origin `http://localhost:5173`.
- Repeating the start command contacts the existing local named-pipe supervisor and opens the same URL without launching duplicate services.
- If either fixed port is occupied, the launcher reports the process category and does not stop it.
- `close.vbs` asks this project's supervisor to stop only its own Vite child and gracefully close its translation-proxy child. The proxy closes its SQLite connection after active HTTP requests finish.
- Logs and the short-lived control token are stored under `%LOCALAPPDATA%\Marginalia\launcher`; the token is not an API credential. No project data is stored there.

The launcher does not create, clear, or migrate browser storage or SQLite data. The proxy still runs its existing database initialization on startup. The Vite development scripts and translation-server script remain unchanged.
