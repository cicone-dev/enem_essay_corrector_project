// Modelos (Mongo/Mongoose, Sequelize etc.)
// info do aluno (se houver login)
import mongoose from 'mongoose';

// login do usuário
const userSchema = new mongoose.Schema({
  name:  { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  profilePic: {
      type: String,
      default: "",
    },
}, { timestamps: true });

export default mongoose.model('User', userSchema);
