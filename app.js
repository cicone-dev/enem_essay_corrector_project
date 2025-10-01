import express from 'express';
import 'dotenv/config';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit'; 
import helmet from 'helmet';
import authRoutes from './src/routes/auth.routes.js';
import essayRoutes from './src/routes/essay.routes.js';
import cookieParser from 'cookie-parser'; 
import { protectRoute } from './src/middlewares/auth.middleware.js';
const FRONTEND_URL = 'http://localhost:5173'; 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({
    // Permite requisições de QUALQUER origem (dominio ou porta)
    origin: FRONTEND_URL, 
    
    // Você ainda pode restringir os métodos, se quiser:
    methods: ['GET', 'POST', 'PUT', 'DELETE'], 
    // Permite o envio de cookies e cabeçalhos de autorização
    credentials: true 
}));

app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true })); // Para dados de formulário
app.set('trust proxy', 1);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Muitas requisições desta API. Por favor, tente novamente mais tarde.'
});

app.use('/auth', apiLimiter, authRoutes);
app.use('/api/essays', protectRoute, apiLimiter, essayRoutes);

app.listen(PORT, () =>
  console.log(`🚀 Cicone's Server running on port ${PORT}!`)
);

export default app;