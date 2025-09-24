import express from 'express';
import 'dotenv/config';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit'; 
import helmet from 'helmet';
import authRoutes from './src/routes/auth.routes.js';
import essayRoutes from './src/routes/essay.routes.js';
import cookieParser from 'cookie-parser'; 
import { protectRoute } from './src/middlewares/auth.middleware.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

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