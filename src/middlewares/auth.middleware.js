import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const protectRoute = async (req, res, next) => {
    try {
        let token = req.cookies.jwt;

        if (!token && req.headers.authorization) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ message: "No token, authorization denied." });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!decoded) {
            return res.status(401).json({ message: "Token is not valid." });
        }

        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: {
                id: true,
                name: true,
                email: true,
                profilePic: true,
            },
        });

        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        req.user = user;
        next();
    } catch (error) {
    // Para logs de depuração:
    console.error("Authentication Error:", error.message);
    
    // Qualquer erro aqui (jwt.verify, token malformado, etc.) é um erro de autenticação.
    // Retorna 401 e encerra a requisição.
    return res.status(401).json({ message: "Token is invalid, expired, or authorization failed." }); 
    }
};