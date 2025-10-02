import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const prisma = new PrismaClient();

const generatePrompt = (essayText, essayTopic) => {
    let prompt = `
    Você é um corretor HUMANO de redações de alta performance, especializado na correção de redações do ENEM por anos.
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

        const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL_NAME });
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




export const getEssayAnalytics = async (userId) => {
    try {
        const essays = await prisma.essay.findMany({
            where: {
                userId: userId
            },
            include: {
                corrections: true
            },
            orderBy: {
                createdAt: 'asc'
            }
        });

        if (essays.length === 0) {
            return {
                totalCorrections: 0,
                averageTotalGrade: 0,
                competencyPerformance: {}
            };
        }

        const totalCorrections = essays.length;
        let totalGradesSum = 0;
        const competencyScores = {
            c1: [],
            c2: [],
            c3: [],
            c4: [],
            c5: []
        };

        essays.forEach(essay => {
            if (essay.corrections && essay.corrections.length > 0) {
                const latestCorrection = essay.corrections[essay.corrections.length - 1];
                totalGradesSum += latestCorrection.total;
                
                // Usando o Object.keys para garantir que o código não quebre se o JSON de notas mudar
                Object.keys(competencyScores).forEach(comp => {
                    const score = latestCorrection.notes[comp]?.nota;
                    if (score !== undefined) {
                        competencyScores[comp].push(score);
                    }
                });
            }
        });

        const averageTotalGrade = totalGradesSum / totalCorrections;

        const competencyPerformance = {};
        Object.keys(competencyScores).forEach(comp => {
            const scores = competencyScores[comp];
            if (scores.length > 0) {
                const sum = scores.reduce((a, b) => a + b, 0);
                competencyPerformance[comp] = sum / scores.length;
            } else {
                competencyPerformance[comp] = 0;
            }
        });

        return {
            totalCorrections: totalCorrections,
            averageTotalGrade: Math.round(averageTotalGrade),
            competencyPerformance: competencyPerformance
        };

    } catch (error) {
        console.error("Erro ao buscar análises de redação:", error.message);
        throw new Error("Não foi possível buscar as análises de redação.");
    }
};


export const getUserAchievements = async (userId) => {
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

        // 1. Defina as conquistas e seus critérios
        const achievements = [
            {
                id: 'first_essay',
                title: 'Primeira Redação',
                description: 'Corrigiu sua primeira redação.',
                unlocked: essays.length >= 1
            },
            {
                id: 'five_essays',
                title: '5 Redações Corrigidas',
                description: 'Corrigiu 5 redações no total.',
                unlocked: essays.length >= 5
            },
            {
                id: 'good_start',
                title: 'Bom Começo',
                description: 'Conseguiu uma nota de 800+ em sua primeira redação.',
                unlocked: false
            },
            {
                id: 'perfect_c5',
                title: 'Competência 5 Perfeita',
                description: 'Alcançou a nota máxima (200) na Competência 5.',
                unlocked: false
            },
            {
                id: 'road_to_1000',
                title: 'Caminho para 1000',
                description: 'Alcançou uma nota de 900+ em uma redação.',
                unlocked: false
            }
        ];

        // 2. Verifique os critérios para as conquistas mais complexas
        const essayGrades = essays.map(e => e.corrections[0]?.total || 0);
        const competency5Grades = essays.map(e => e.corrections[0]?.notes?.c5?.nota || 0);

        // Verifica a conquista "Bom Começo"
        if (essays.length > 0 && essayGrades[0] >= 800) {
            const achievement = achievements.find(a => a.id === 'good_start');
            if (achievement) achievement.unlocked = true;
        }

        // Verifica a conquista "Competência 5 Perfeita"
        if (competency5Grades.some(grade => grade >= 200)) {
            const achievement = achievements.find(a => a.id === 'perfect_c5');
            if (achievement) achievement.unlocked = true;
        }

        // Verifica a conquista "Caminho para 1000"
        if (essayGrades.some(grade => grade >= 900)) {
            const achievement = achievements.find(a => a.id === 'road_to_1000');
            if (achievement) achievement.unlocked = true;
        }

        return achievements;
    } catch (error) {
        console.error("Erro ao buscar conquistas:", error.message);
        throw new Error("Não foi possível buscar as conquistas.");
    }
};

export const getEssayById = async (essayId, userId) => { // ADICIONE userId aqui
    try {
        const essay = await prisma.essay.findUnique({
            where: {
                id: essayId,
                userId: userId // CRUCIAL: Garante que a redação pertença ao usuário
            },
            include: {
                corrections: {
                    orderBy: {
                        createdAt: 'desc'
                    }
                }
            }
        });

        if (!essay) {
            // Lança um erro com um nome específico para o controller identificar
            throw new Error("Redação não encontrada.");
        }

        return essay;
        } catch (error) {
        console.error("Erro ao buscar redação por ID:", error.message);
        // Não vamos mais lançar o erro genérico. Vamos lançar o erro original
        // do Prisma, que será pego no controller. Isso evita a confusão do 500.
        throw error; 
    }
};