FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_BACKEND_URL
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/build-server ./build-server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8787
CMD ["node", "build-server/server/main.js"]
