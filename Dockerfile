FROM node:20-slim

# Claude Code CLI (default provider needs it)
RUN npm install -g @anthropic-ai/claude-code

# Git is required for workspace type "git" (clone + worktree)
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
COPY .env.example ./

# Overlays mount point + bridge working directory
RUN mkdir -p /app/overlays /tmp/agent-bridge

ENV BRIDGE_BASE_DIR=/tmp/agent-bridge
ENV BRIDGE_OVERLAYS_DIR=/app/overlays

CMD ["node", "dist/transport.js"]
