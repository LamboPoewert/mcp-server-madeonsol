FROM node:22-slim
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY dist/ dist/
ENV MCP_TRANSPORT=http
ENV PORT=3200
EXPOSE 3200
CMD ["node", "dist/index.js"]
