import multer from 'multer';

const storage = multer.memoryStorage(); // Armazena a imagem na memória como um buffer
const upload = multer({ storage: storage });

export { upload };