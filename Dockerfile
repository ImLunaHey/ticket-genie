FROM oven/bun as builder

WORKDIR /app

# Install required packages
COPY package*.json bun.lockb /app/
RUN bun i

# Copy source files
COPY src /app/src
COPY tsconfig.json /app/
COPY patches /app/patches

# Build application
RUN bun run build

# ==== Final Image
FROM oven/bun as final
USER bun:bun
WORKDIR /app

# Copying build output
COPY --from=builder --chown=bun:bun /app/package*.json /app/bun.lockb ./
COPY --from=builder --chown=bun:bun /app/dist dist

# Copy assets
COPY --chown=bun:bun assets /app/assets

# Install only the production dependencies
RUN bun i --production

CMD bun run start
