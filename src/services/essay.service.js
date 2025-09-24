import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const prisma = new PrismaClient();

const generatePrompt = (essayText, essayTopic) => {
    let prompt = `
    Você é um corretor de redações de alta performance, especializado na correção de redações do ENEM.
    Sua tarefa é avaliar a redação de acordo com as cinco competências do ENEM (C1 a C5) e fornecer uma análise textual completa.
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
      "feedbackGeral": string,
      "pontosPositivos": string,
      "pontosA_Melhorar": string,
      "analiseTextual": {
        "coesaoE_Coerencia": string,
        "repertorioSociocultural": string,
        "dominioDaGramatica": string,
        "argumentacao": string
      },
      "sugestoesDeMelhora": string
    }
    
    A nota de cada competência deve ser um múltiplo de 40 (0, 40, 80, 120, 160, 200). A nota total deve ser a soma das cinco competências.
    O feedback geral deve ser conciso. Use o campo 'pontosPositivos' para resumir os acertos da redação e o 'pontosA_Melhorar' para os principais problemas. A 'analiseTextual' deve conter comentários técnicos sobre coesão, repertório, gramática e argumentação. As 'sugestoesDeMelhora' devem ser um parágrafo único com dicas práticas.

    A redação a ser corrigida é:
    
    "${essayText}"
    `;

    if (essayTopic) {
        prompt += `\nO tema específico da redação é: "${essayTopic}"`;
    }

    return prompt;
};

export const correctEssay = async (userId, essayData) => {
    try {
        const { text, topic } = essayData;

        if (!text) {
            throw new Error("O campo 'text' é obrigatório.");
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = generatePrompt(text, topic);

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
                topic: topic,
                corrections: {
                    create: {
                        notes: correctionResult.competencias,
                        total: correctionResult.total,
                    },
                },
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

export const getEssayHistory = async (userId) => {
    try {
        const essays = await prisma.essay.findMany({
            where: {
                userId: userId
            },
            include: {
                corrections: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        return essays;
    } catch (error) {
        console.error("Erro ao buscar histórico de redações:", error.message);
        throw new Error("Não foi possível buscar o histórico de redações.");
    }
};