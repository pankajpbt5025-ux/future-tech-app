FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000
# uploads/ और data.db को persistent volume पर रखें (जैसे /data)
EXPOSE 3000
CMD ["node","server.js"]
