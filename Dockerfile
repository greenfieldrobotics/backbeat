FROM node:20-bookworm

# Git for development workflows
RUN apt-get update && \
    apt-get install -y git && \
    rm -rf /var/lib/apt/lists/*

# Claude CLI for AI-assisted development
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

CMD ["bash"]
