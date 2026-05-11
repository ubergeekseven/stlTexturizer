FROM node:22-alpine

WORKDIR /app

COPY server/package.json server/
RUN cd server && npm install --production

COPY . .

ENV PORT=3000
ENV DATA_DIR=/data

EXPOSE 3000

CMD ["node", "server/server.js"]
