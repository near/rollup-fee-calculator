FROM node:12.18.1

WORKDIR /app
COPY package.json package.json
COPY package-lock.json package-lock.json
RUN npm install
COPY index.ts index.ts
RUN npm run build
EXPOSE 3000

CMD [ "npm", "start" ]
