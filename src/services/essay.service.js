import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Inicializa o cliente Gemini e Prisma
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const prisma = new PrismaClient();

// --- Funções Auxiliares ---

/**
 * Gera o prompt detalhado para o modelo Gemini, definindo seu papel e o formato de saída JSON.
 * @param {string} essayText - O texto da redação submetida.
 * @param {string} essayTopic - O tema da redação.
 * @returns {string} O prompt completo.
 */
const generatePrompt = (essayText, essayTopic) => {
    return `
    Você é um corretor HUMANO de redações de alta performance, especializado na correção de redações do ENEM por anos.
    Sua tarefa é avaliar a redação de acordo com as cinco competências do ENEM (C1 a C5) e fornecer uma análise textual completa.
    
    A nota de cada competência deve ser um múltiplo de 40 (0, 40, 80, 120, 160, 200). A nota TOTAL deve ser a soma das 5 notas.
    
    O TEMA da redação é: "${essayTopic}".
    A REDAÇÃO submetida é:
    ---
    ${essayText}
    ---
    
    Sua resposta DEVE ser estruturada EXCLUSIVAMENTE em JSON e seguir este formato:
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
        "coesaoEConexao": string,
        "vocabulario": string,
        "gramaticaEOrtografia": string
      },
      "sugestoesDeMelhora": string
    }
    `;
};

/**
 * Tenta fazer o parse de uma string JSON, tratando erros.
 * @param {string} jsonString - A string JSON a ser parseada.
 * @returns {object|null} O objeto parseado ou null em caso de erro.
 */
const parseJsonSafely = (jsonString) => {
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.error("Erro ao parsear JSON da correção:", e);
        return null;
    }
};

/**
 * Cria e persiste a correção no banco de dados.
 * @param {string} essayId - ID da redação.
 * @param {object} correctionContent - O objeto de correção gerado pelo Gemini.
 */
const createCorrection = async (essayId, correctionContent) => {
    return prisma.correction.create({
        data: {
            essayId,
            content: JSON.stringify(correctionContent), // Salva o conteúdo como string
        },
    });
};

// --- Funções de Serviço ---

/**
 * Processa a submissão e correção de uma nova redação.
 */
export const submitEssay = async (userId, topic, essayText) => {
    try {
        // 1. Cria a redação no banco de dados
        const newEssay = await prisma.essay.create({
            data: {
                userId,
                topic,
                content: essayText,
            },
        });

        // 2. Gera o prompt para o modelo
        const prompt = generatePrompt(essayText, topic);

        // 3. Chamada à API do Gemini
        const response = await genAI.getGenerativeModel({ model: "gemini-2.5-flash" }).generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
                responseMimeType: "application/json",
                // Define o schema esperado
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        competencias: {
                            type: "OBJECT",
                            properties: {
                                c1: { type: "OBJECT" }, c2: { type: "OBJECT" }, c3: { type: "OBJECT" },
                                c4: { type: "OBJECT" }, c5: { type: "OBJECT" }
                            }
                        },
                        total: { type: "NUMBER" },
                        feedbackGeral: { type: "STRING" },
                        pontosPositivos: { type: "STRING" },
                        pontosA_Melhorar: { type: "STRING" },
                        analiseTextual: { type: "OBJECT" },
                        sugestoesDeMelhora: { type: "STRING" }
                    }
                }
            }
        });

        // O conteúdo do JSON vem como uma string no campo 'text'
        const rawJson = response.text.trim();
        const correctionData = parseJsonSafely(rawJson);

        if (!correctionData) {
            throw new Error("Resposta do modelo inválida ou formato JSON incorreto.");
        }

        // 4. Cria a correção no banco de dados
        const correction = await createCorrection(newEssay.id, correctionData);

        // 5. Retorna a redação com o conteúdo da correção para o frontend
        return {
            ...newEssay,
            latestCorrection: correctionData,
            correctionId: correction.id,
        };

    } catch (error) {
        console.error("Erro no submitEssay:", error.message);
        // Garante que o erro seja lançado para ser capturado no controller
        throw error;
    }
};

/**
 * NOVO: Busca uma redação específica por ID.
 * ESSENCIAL para a página de detalhes (EssayDetailPage).
 * @param {string} essayId - ID da redação.
 * @param {string} userId - ID do usuário autenticado.
 * @returns {object} A redação e sua última correção parseada.
 */
export const getEssayById = async (essayId, userId) => {
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
                    },
                    // Limita a 1, já que só queremos a correção mais recente.
                    take: 1
                }
            }
        });

        if (!essay) {
            throw new Error("Redação não encontrada ou acesso negado.");
        }

        // Adiciona um parseamento seguro da correção para o frontend
        if (essay.corrections && essay.corrections.length > 0) {
            const latestCorrection = essay.corrections[0];
            essay.latestCorrection = parseJsonSafely(latestCorrection.content);
        } else {
            essay.latestCorrection = null;
        }

        return essay;
    } catch (error) {
        console.error("Erro ao buscar redação por ID:", error.message);
        throw error;
    }
};

/**
 * ATUALIZADO: Busca o histórico simples de redações.
 * ESSENCIAL para a tabela de histórico (HistoryPage).
 * @param {string} userId - ID do usuário.
 * @returns {Array<object>} Lista de redações com a nota total e dados principais.
 */
export const getEssayHistory = async (userId) => {
    try {
        // Busca todas as redações do usuário
        const essays = await prisma.essay.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            include: {
                // Inclui a correção mais recente para exibir a nota total
                corrections: {
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 1
                }
            }
        });

        // Mapeia e sanitiza o resultado para o frontend
        return essays.map(essay => {
            const correction = essay.corrections[0];
            const parsedContent = correction ? parseJsonSafely(correction.content) : null;

            return {
                id: essay.id,
                topic: essay.topic,
                createdAt: essay.createdAt,
                // Retorna APENAS o conteúdo da correção parseado
                correction: parsedContent
            };
        }).filter(essay => essay.correction !== null); // Filtra as que falharam o parse
    } catch (error) {
        console.error("Erro ao buscar histórico de redações:", error.message);
        throw new Error("Não foi possível carregar o histórico.");
    }
};

/**
 * CORRIGIDO E COMPLETO: Calcula as métricas de Analytics.
 * ESSENCIAL para o Dashboard (DashboardPage) funcionar com gráficos.
 * @param {string} userId - ID do usuário.
 * @returns {object} Objeto com todas as métricas agregadas.
 */
export const getEssayAnalytics = async (userId) => {
    try {
        // 1. Busca todas as redações do usuário com a última correção
        const allEssays = await prisma.essay.findMany({
            where: { userId },
            orderBy: { createdAt: 'asc' }, // Ordenar por data para o histórico/gráficos
            include: {
                corrections: {
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 1
                }
            }
        });

        // Filtra redações que realmente têm correções e parseia o conteúdo
        const gradedEssays = allEssays
            .filter(essay => essay.corrections.length > 0)
            .map(essay => {
                const correction = essay.corrections[0];
                const parsedContent = parseJsonSafely(correction.content);
                return {
                    ...essay,
                    latestCorrection: parsedContent
                };
            })
            .filter(essay => essay.latestCorrection !== null); // Remove falhas de parsing

        const totalEssays = gradedEssays.length;

        // Se não houver redações corrigidas, retorna um objeto de análise com valores zerados
        if (totalEssays === 0) {
            return {
                totalEssays: 0,
                averageScore: 0,
                scoreHistory: [],
                competenceAverages: [],
                latestEssays: [],
                totalWords: 0
            };
        }

        // 2. Cálculo da Nota Média
        const totalScoreSum = gradedEssays.reduce((sum, essay) => sum + (essay.latestCorrection?.total || 0), 0);
        const averageScore = Math.round(totalScoreSum / totalEssays) || 0;

        // 3. Histórico de Notas (para o gráfico de linha/barra)
        const scoreHistory = gradedEssays.map(essay => ({
            date: new Date(essay.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
            total: essay.latestCorrection.total || 0,
        }));

        // 4. Média por Competência (para o Radar Chart)
        const competenceSum = gradedEssays.reduce((acc, essay) => {
            const comps = essay.latestCorrection?.competencias;
            if (comps) {
                acc.c1 += comps.c1?.nota || 0;
                acc.c2 += comps.c2?.nota || 0;
                acc.c3 += comps.c3?.nota || 0;
                acc.c4 += comps.c4?.nota || 0;
                acc.c5 += comps.c5?.nota || 0;
            }
            return acc;
        }, { c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 });

        const competenceAverages = [
            // O campo 'A' representa o valor médio alcançado (Actual)
            { subject: 'C1', A: Math.round(competenceSum.c1 / totalEssays) || 0, fullMark: 200 },
            { subject: 'C2', A: Math.round(competenceSum.c2 / totalEssays) || 0, fullMark: 200 },
            { subject: 'C3', A: Math.round(competenceSum.c3 / totalEssays) || 0, fullMark: 200 },
            { subject: 'C4', A: Math.round(competenceSum.c4 / totalEssays) || 0, fullMark: 200 },
            { subject: 'C5', A: Math.round(competenceSum.c5 / totalEssays) || 0, fullMark: 200 },
        ];

        // 5. Últimas 3 Redações (para o card no dashboard)
        // Pega as 3 mais recentes, por isso usa slice e reverse (já que o array original está em ordem 'asc')
        const latestEssays = gradedEssays.slice(-3).reverse().map(essay => ({
            id: essay.id,
            topic: essay.topic,
            total: essay.latestCorrection.total || 0,
            createdAt: essay.createdAt
        }));

        // 6. Contagem de palavras (muito aproximada, soma o count de cada redação)
        const totalWords = gradedEssays.reduce((sum, essay) => {
             return sum + (essay.content?.split(/\s+/).length || 0);
        }, 0);


        return {
            totalEssays,
            averageScore,
            scoreHistory,
            competenceAverages,
            latestEssays,
            totalWords
        };

    } catch (error) {
        console.error("Erro ao calcular analytics:", error.message);
        throw new Error("Não foi possível gerar as análises do dashboard.");
    }
};

/**
 * ATUALIZADO: Busca as conquistas e verifica o status de desbloqueio.
 */
export const getAchievements = async (userId) => {
    try {
        const essays = await prisma.essay.findMany({
            where: { userId },
            include: {
                corrections: {
                    orderBy: { createdAt: 'desc' },
                    take: 1
                }
            }
        });

        const gradedEssays = essays.filter(e => e.corrections.length > 0);

        const essayGrades = gradedEssays
            .map(e => parseJsonSafely(e.corrections[0].content)?.total)
            .filter(score => score != null); // Filtra nulos/undefineds

        const achievements = [
            { id: 'first_essay', title: 'Primeiro Passo', description: 'Submeta sua primeira redação.', unlocked: false },
            { id: 'five_essays', title: 'Cinco na Conta', description: 'Submeta 5 redações.', unlocked: false },
            { id: 'road_to_1000', title: 'Quase Perfeito', description: 'Alcance uma nota de 900+.', unlocked: false },
            { id: 'master_c5', title: 'Domínio da C5', description: 'Alcance a nota máxima (200) na C5.', unlocked: false },
        ];

        // Verifica a conquista "Primeiro Passo"
        if (essayGrades.length >= 1) {
            const achievement = achievements.find(a => a.id === 'first_essay');
            if (achievement) achievement.unlocked = true;
        }

        // Verifica a conquista "Cinco na Conta"
        if (essayGrades.length >= 5) {
            const achievement = achievements.find(a => a.id === 'five_essays');
            if (achievement) achievement.unlocked = true;
        }

        // Verifica a conquista "Caminho para 1000"
        if (essayGrades.some(grade => grade >= 900)) {
            const achievement = achievements.find(a => a.id === 'road_to_1000');
            if (achievement) achievement.unlocked = true;
        }

        // Verifica a conquista "Domínio da C5"
        const c5Scores = gradedEssays
            .map(e => parseJsonSafely(e.corrections[0].content)?.competencias?.c5?.nota)
            .filter(score => score != null);

        if (c5Scores.some(score => score === 200)) {
            const achievement = achievements.find(a => a.id === 'master_c5');
            if (achievement) achievement.unlocked = true;
        }

        return achievements;
    } catch (error) {
        console.error("Erro ao buscar conquistas:", error.message);
        throw new Error("Não foi possível buscar as conquistas.");
    }
};
