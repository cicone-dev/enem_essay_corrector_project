````markdown
# 📝 API de Correção de Redações

Este repositório contém o backend completo para um sistema de correção de redações com integração de IA.  
A aplicação permite autenticação de usuários, envio e correção de textos, visualização de histórico, análise de desempenho e sistema de conquistas.

---

## ✅ Status do Projeto

- **Configuração do Projeto:** Servidor backend em **Node.js**.
- **Banco de Dados:** Conexão via **Prisma** totalmente funcional.
- **Integração com IA:** API do **Google Gemini** concluída.  
  O servidor envia a redação e recebe a correção automaticamente.
- **Lógica de Negócios:**
  - Recebe o texto da redação do usuário.
  - Envia o texto para a IA.
  - Processa a resposta da IA.
  - Salva a redação corrigida no banco de dados, vinculando ao usuário.
  - Retorna o histórico de redações do usuário.

---

## 📌 Visão Geral

Esta **API REST** fornece todas as funcionalidades para um sistema de correção de redações:

- Autenticação de usuários.
- Envio e correção de redações.
- Histórico de correções.
- Análise de dados agregados para dashboards.
- Sistema de conquistas.

> Todas as rotas exigem autenticação via **token JWT** no cabeçalho  
> `Authorization: Bearer <token>`.

---

## 🔗 Endpoints da API

### 1️⃣ Autenticação de Usuário

#### **POST** `/api/auth/register`
Registra um novo usuário.

**Corpo da Requisição:**
```json
{
  "email": "string",
  "password": "string",
  "name": "string",
  "profilePic": "string"
}
````

**Resposta:**

```json
{
  "message": "User registered successfully",
  "user": {
    "id": "string",
    "name": "string",
    "email": "string"
  }
}
```

#### **POST** `/api/auth/login`

Autentica o usuário e retorna um token JWT.

**Corpo da Requisição:**

```json
{
  "email": "string",
  "password": "string"
}
```

**Resposta:**

```json
{
  "token": "string",
  "user": {
    "id": "string",
    "email": "string"
  }
}
```

#### **PUT** `/api/users/profile-pic`

Atualiza a foto de perfil do usuário autenticado.

**Corpo da Requisição:**

```json
{
  "profilePic": "string"
}
```

**Resposta:**

```json
{
  "message": "Profile picture updated successfully."
}
```

---

### 2️⃣ Redações e Dados do Usuário

#### **POST** `/api/essays`

Envia uma redação para correção e salva no histórico.

**Corpo da Requisição:**

```json
{
  "text": "string",
  "topic": "string"
}
```

**Resposta:**

```json
{
  "id": "string",
  "competencias": {
    "c1": { "nota": "number", "comentario": "string" },
    "c2": { "nota": "number", "comentario": "string" },
    "c3": { "nota": "number", "comentario": "string" },
    "c4": { "nota": "number", "comentario": "string" },
    "c5": { "nota": "number", "comentario": "string" }
  },
  "total": "number",
  "feedbackGeral": "string",
  "pontosPositivos": "string",
  "pontosA_Melhorar": "string",
  "analiseTextual": {
    "coesaoE_Coerencia": "string",
    "repertorioSociocultural": "string",
    "dominioDaGramatica": "string",
    "argumentacao": "string"
  },
  "sugestoesDeMelhora": "string"
}
```

#### **GET** `/api/essays/history`

Retorna todas as redações do usuário (mais recentes primeiro).

**Resposta:**

```json
[
  {
    "id": "string",
    "text": "string",
    "topic": "string",
    "createdAt": "date-string",
    "corrections": [
      { "notes": "json", "total": "number", "createdAt": "date-string" }
    ]
  }
]
```

#### **GET** `/api/essays/analytics`

Retorna dados agregados para o dashboard.

**Resposta:**

```json
{
  "totalCorrections": "number",
  "averageTotalGrade": "number",
  "competencyPerformance": {
    "c1": "number",
    "c2": "number",
    "c3": "number",
    "c4": "number",
    "c5": "number"
  }
}
```

#### **GET** `/api/essays/achievements`

Lista conquistas e status de desbloqueio.

**Resposta:**

```json
{
  "id": "string",
  "title": "string",
  "description": "string",
  "unlocked": "boolean"
}
```

---

## 🖥️ Requisitos e Estrutura do Frontend

Para integrar esta API, recomenda-se um frontend com as seguintes telas:

### Telas Principais

* **Login/Cadastro:**
  Formulários para `POST /api/auth/login` e `POST /api/auth/register`.
  Deve armazenar o **token JWT** para autenticação.

* **Dashboard (Página Inicial):**

  * Painel de Estatísticas: Consome `GET /api/essays/analytics` e exibe gráficos (barras, radar, etc.).
  * Conquistas: Consome `GET /api/essays/achievements` exibindo ícones bloqueados/desbloqueados.

* **Correção de Redação:**

  * Campo de texto para a redação.
  * Campo para o tema.
  * Botão **“Corrigir Redação”** para enviar `POST /api/essays`.

* **Feedback da Redação:**

  * Exibe a resposta completa do `POST /api/essays`.
  * Mostra nota total em destaque, notas e comentários de cada competência, pontos positivos, pontos a melhorar e análise textual.

* **Histórico:**

  * Lista todas as redações usando `GET /api/essays/history` em formato de lista ou tabela.

---

## 🚀 Tecnologias Principais

* **Node.js** • **Express** • **Prisma**
* **Google Gemini API** para correção automática
* **JWT** para autenticação
* Banco de Dados **relacional** (via Prisma)

---

## 📄 Feito por Cauan Cicone 

projeto totalmente desenvolvido por Cauan Cicone Fidélis

```
```
