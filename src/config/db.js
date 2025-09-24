// Configurações (db, dotenv, etc.)
import mongoose from 'mongoose';

export async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('🆗 MongoDB conectado!');
  } catch (err) {
    console.error('Erro ao conectar no Mongo', err);
    process.exit(1);
  }
}

