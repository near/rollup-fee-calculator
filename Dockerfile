FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./


# Install app dependencies
RUN npm ci

COPY . .
RUN npm run build
EXPOSE 3000

CMD [ "node", "main.js" ]
