# Etapa 1: Build
FROM node:18-alpine AS build

WORKDIR /app

# Copiamos archivos de dependencias
COPY package*.json ./

# Copiamos el directorio prisma antes de instalar para que 'postinstall' funcione
COPY prisma ./prisma/

# Instalamos todas las dependencias (incluyendo devDependencies para compilar TS)
RUN npm install

# Copiamos el resto del código fuente
COPY . .

# Generamos el cliente de Prisma explícitamente (por seguridad)
RUN npx prisma generate

# Compilamos el proyecto TypeScript a JavaScript (genera carpeta dist/)
RUN npm run build

# Etapa 2: Runtime
FROM node:18-alpine AS runtime

WORKDIR /app

# Instalamos dependencias necesarias para producción (como OpenSSL para Prisma)
RUN apk add --no-cache openssl

# Copiamos package.json y package-lock.json
COPY --from=build /app/package*.json ./

# Copiamos node_modules de la etapa de build
# Nota: Podríamos hacer un 'npm ci --only=production' aquí para reducir tamaño,
# pero copiarlos asegura que tenemos las versiones exactas y el cliente prisma generado.
COPY --from=build /app/node_modules ./node_modules

# Copiamos el código compilado
COPY --from=build /app/dist ./dist

# Copiamos la carpeta prisma y scripts por si necesitamos correr migraciones en producción
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts

# Exponer el puerto (Railway asigna PORT dinámicamente, pero esto es buena práctica)
EXPOSE 3001

# Comando de inicio
CMD ["node", "dist/index.js"]
