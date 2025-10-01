// back/src/controllers/auth.controller.js

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v2 as cloudinary } from 'cloudinary';

const prisma = new PrismaClient();

// Configuração do Cloudinary (Mantenha sua configuração real aqui)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Gera o JWT, configura-o como cookie e retorna o token gerado.
 */
const generateTokenAndSetCookie = (userId, res) => {
    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
        expiresIn: '15d',
    });
    res.cookie('jwt', token, {
        maxAge: 15 * 24 * 60 * 60 * 1000, // 15 days
        httpOnly: true, // Previne ataques XSS
        
        // 🚨 CORREÇÃO FINAL OBRIGATÓRIA: Para cookies cross-site (localhost <-> Render HTTPS)
        sameSite: "None", 
        secure: true, // 'SameSite: None' requer 'Secure: true'
    });
    return token; 
};

export const register = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        
        if (!name || !email || !password) {
            return res.status(400).json({ message: "Please fill all fields." });
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (user) {
            return res.status(400).json({ message: "Email already in use." });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
            },
        });

        if (newUser) {
            const token = generateTokenAndSetCookie(newUser.id, res); 
            
            // ✅ RESPOSTA CORRIGIDA: Retorna { token, user }
            res.status(201).json({
                token: token,
                user: {
                    id: newUser.id,
                    name: newUser.name,
                    email: newUser.email,
                    profilePic: newUser.profilePic,
                }
            });
        } else {
            res.status(400).json({ message: "Invalid user data." });
        }
    } catch (error) {
        console.error("Error in register controller:", error.message);
        res.status(500).json({ message: "Internal Server Error" });
    }
};

export const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // ✅ CORREÇÃO PRISMA: Garante que a senha é buscada para comparação
        const user = await prisma.user.findUnique({ 
            where: { email },
            select: { 
                id: true,
                name: true,
                email: true,
                password: true, // ESSENCIAL: Permite a comparação
                profilePic: true,
            }
        }); 

        if (!user) {
            return res.status(400).json({ message: "Invalid credentials." });
        }
        
        const isPasswordCorrect = await bcrypt.compare(password, user.password); 
        if (!isPasswordCorrect) {
            return res.status(400).json({ message: "Invalid credentials." });
        }

        const token = generateTokenAndSetCookie(user.id, res); 
        
        // ✅ RESPOSTA CORRIGIDA: Retorna { token, user }
        res.status(200).json({
            token: token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                profilePic: user.profilePic,
            }
        });
    } catch (error) {
        console.error("Error in login controller:", error.message);
        res.status(500).json({ message: "Internal Server Error" });
    }
};

export const updateProfilePic = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded." });
        }

        let user = req.user;
        
        // A lógica de upload de imagem para o Cloudinary usando buffer
        const result = await cloudinary.uploader.upload(
            `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`
        );
        
        if (!result || !result.secure_url) {
            return res.status(500).json({ message: "Failed to upload to Cloudinary." });
        }

        user = await prisma.user.update({
            where: { id: user.id },
            data: { profilePic: result.secure_url },
            select: {
                id: true,
                name: true,
                email: true,
                profilePic: true,
            },
        });

        res.status(200).json({
            id: user.id,
            name: user.name,
            email: user.email,
            profilePic: user.profilePic,
        });

    } catch (error) {
        console.error("Error updating profile picture:", error.message);
        res.status(500).json({ message: "Error updating profile picture." });
    }
};