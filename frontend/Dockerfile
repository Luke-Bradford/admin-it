FROM node:20-slim

WORKDIR /app

# Copy ONLY package.json (not package-lock.json)
COPY package.json ./

# Install
RUN npm install

# Copy frontend source
COPY ./src ./src
COPY vite.config.js .
COPY index.html .

EXPOSE 3000

CMD ["npm", "run", "dev"]
