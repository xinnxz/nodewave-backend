FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN bunx prisma generate

# Copy application source
COPY src ./src
COPY tsconfig.json ./

EXPOSE 4000

CMD ["sh", "-c", "bunx prisma db push && bun prisma/seed.ts && bun run src/index.ts"]
