import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const prisma = new PrismaClient();

const generatePrompt = (essayText) => `
    Você é um corretor de redações de alta performance, especializado na correção de redações do ENEM.
    Sua tarefa é avaliar a redação de acordo com as cinco competências do ENEM (C1 a C5).
    Sua resposta deve ser estruturada em JSON e seguir este formato:
    {
      "competencias": {
        "c1": {
          "nota": number,
          "comentario": string
        },
        "c2": {
          "nota": number,
          "comentario": string
        },
        "c3": {
          "nota": number,
          "comentario": string
        },
        "c4": {
          "nota": number,
          "comentario": string
        },
        "c5": {
          "nota": number,
          "comentario": string
        }
      },
      "total": number,
      "feedbackGeral": string
    }
    
    A nota de cada competência deve ser um múltiplo de 40 (0, 40, 80, 120, 160, 200). A nota total deve ser a soma das cinco competências.
    O feedback geral deve ser conciso e útil.
    Aqui está a redação para você corrigir:
    
    "${essayText}"
`;

export const correctEssay = async (userId, essayData) => {
    try {
        const { text } = essayData;

        if (!text) {
            throw new Error("O campo 'text' é obrigatório.");
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = generatePrompt(text);

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let responseText = response.text();

        const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
        let correctionResult;

        try {
            if (jsonMatch) {
                const jsonString = jsonMatch[1];
                correctionResult = JSON.parse(jsonString);
            } else {
                correctionResult = JSON.parse(responseText);
            }
        } catch (jsonError) {
            console.error("Erro ao fazer parse do JSON:", jsonError.message);
            console.error("Resposta original do Gemini:", responseText);
            throw new Error("Resposta da IA não está no formato correto.");
        }

        const savedEssay = await prisma.essay.create({
            data: {
                userId: userId,
                text: text,
                notes: correctionResult.competencias,
                total: correctionResult.total,
            },
        });

        return {
            id: savedEssay.id,
            ...correctionResult
        };

    } catch (error) {
        console.error("Erro na correção da redação:", error);
        throw new Error("Não foi possível corrigir a redação.");
    }
};