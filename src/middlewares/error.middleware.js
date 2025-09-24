export const errorHandler = (err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal Server Error' });
  next();
}
export default errorHandler;


//Middleware de tratamento de erros//Registra o erro no console e retorna 500 Internal Server Error
//Chama o próximo middleware (se houver)// (útil se houver mais middlewares de erro)