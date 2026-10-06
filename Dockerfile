# NyxilumMcp у контейнері: MCP-сервер по stdio (docker run -i). Потрібен
# каталогам MCP (m8ven, Glama тощо), які збирають образ і перевіряють,
# що сервер стартує й віддає список інструментів.
FROM node:22-bookworm-slim
ARG NX_VERSION=v1.8.3
# nx (NyxilumNode) з офіційного релізу - інструменти запускають .nx-код.
# libicu72 - .NET без неї падає; змінна DOTNET_SYSTEM_GLOBALIZATION_INVARIANT
# не допомагає: run.js навмисно передає nx лише білий список змінних.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl libicu72 \
 && mkdir -p /opt/nx \
 && curl -fsSL "https://github.com/Faneraiy14/NyxilumNode/releases/download/${NX_VERSION}/Nx-linux-x64.tar.gz" \
    | tar xz -C /opt/nx ./Nx \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 \
    NX_NODE_PATH=/opt/nx/Nx
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src

ENTRYPOINT ["node", "src/server.js"]
