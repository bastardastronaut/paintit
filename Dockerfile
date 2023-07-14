FROM node:18

# Create app directory
WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

CMD node src/index.js
