# 1. Use uma imagem base leve e estável do Node.js
FROM node:22.19.0-alpine

# 2. Defina o diretório de trabalho dentro do container
WORKDIR /usr/src/app

# 3. Copie os arquivos package.json e instale as dependências
# O cache do Docker acelera a build se estes arquivos não mudarem
COPY package*.json ./
RUN npm install

# 4. Copie o resto dos arquivos da aplicação para o container
# Note que o .dockerignore vai impedir que node_modules seja copiado (já instalamos)
COPY . .

# 5. Gere o cliente Prisma dentro do container
# O Prisma precisa do DATABASE_URL para gerar o cliente, então use o ARG/ENV
ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}
RUN npx prisma generate

# 6. Exponha a porta que a aplicação Node.js usa (3000)
EXPOSE 3000

# 7. Comando para iniciar a aplicação
# Use o comando de start do seu package.json
CMD [ "npm", "run", "dev" ] 
# OU use o comando de produção, se você tiver um:
# CMD [ "npm", "start" ]