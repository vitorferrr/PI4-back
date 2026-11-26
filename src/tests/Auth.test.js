import { beforeEach, describe, expect, it, vi } from "vitest";
import argon2 from "argon2";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Sequelize from "sequelize";
import models from "../models/index.js";
import authService from "../services/authService.js";
import authController from "../controllers/authController.js";
import autenticar, { autenticarLogout } from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";

vi.mock("../models/index.js", () => ({
  default: {
    Usuario: {
      findOne: vi.fn(),
    },
    TokenRevogado: {
      findOne: vi.fn(),
      bulkCreate: vi.fn(),
      destroy: vi.fn(),
    },
  },
}));

const { TokenRevogado, Usuario } = models;
const SEGREDO = "segredo-de-teste";

const criarRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = SEGREDO;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("login (authService)", () => {
  it("retorna token válido e dados do usuário sem a senha", async () => {
    const senha_hash = await argon2.hash("1234");
    Usuario.findOne.mockResolvedValue({
      id: 1,
      nome: "Bia",
      email: "bia@exemplo.com",
      role: "gestor",
      senha_hash,
    });

    const resultado = await authService.login({
      email: "bia@exemplo.com",
      senha: "1234",
    });
    const payload = jwt.verify(resultado.token, SEGREDO);

    expect(Usuario.findOne).toHaveBeenCalledWith({
      where: { email: "bia@exemplo.com" },
    });
    expect(payload).toMatchObject({ id: 1, role: "gestor" });
    expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.exp - payload.iat).toBe(3600);
    expect(resultado.usuario).toEqual({
      id: 1,
      nome: "Bia",
      email: "bia@exemplo.com",
      role: "gestor",
    });
  });

  it("procura o email sem espaços e em minúsculas", async () => {
    Usuario.findOne.mockResolvedValue(null);

    await expect(
      authService.login({ email: "  Bia@Exemplo.COM ", senha: "1234" })
    ).rejects.toMatchObject({ name: "AutenticacaoError" });

    expect(Usuario.findOne).toHaveBeenCalledWith({ where: { email: "bia@exemplo.com" } });
  });

  it.each([[123], [["bia@exemplo.com"]], ["   "]])(
    "rejeita email que não é texto preenchido (%o) sem consultar o banco",
    async (email) => {
      await expect(authService.login({ email, senha: "1234" })).rejects.toMatchObject({
        name: "AutenticacaoError",
      });
      expect(Usuario.findOne).not.toHaveBeenCalled();
    }
  );

  it("rejeita quando email ou senha não são informados", async () => {
    await expect(authService.login({ email: "bia@exemplo.com" })).rejects.toThrow(
      "Email ou senha inválidos"
    );
    await expect(authService.login()).rejects.toThrow("Email ou senha inválidos");
    expect(Usuario.findOne).not.toHaveBeenCalled();
  });

  it("rejeita quando o usuário não existe", async () => {
    Usuario.findOne.mockResolvedValue(null);

    await expect(
      authService.login({ email: "x@exemplo.com", senha: "1234" })
    ).rejects.toMatchObject({ name: "AutenticacaoError" });
  });

  it("bloqueia o login de cadastro ainda não aprovado", async () => {
    Usuario.findOne.mockResolvedValue({
      id: 1,
      role: "fiscalizador",
      aprovado: false,
      senha_hash: await argon2.hash("senha-forte"),
    });

    await expect(
      authService.login({ email: "bia@exemplo.com", senha: "senha-forte" })
    ).rejects.toMatchObject({
      name: "CadastroPendenteError",
      message: "Cadastro aguardando aprovação de um administrador",
    });
  });

  it("não revela cadastro pendente para quem erra a senha", async () => {
    Usuario.findOne.mockResolvedValue({
      id: 1,
      aprovado: false,
      senha_hash: await argon2.hash("senha-forte"),
    });

    await expect(
      authService.login({ email: "bia@exemplo.com", senha: "errada" })
    ).rejects.toMatchObject({ name: "AutenticacaoError" });
  });

  it("rejeita quando a senha está errada", async () => {
    Usuario.findOne.mockResolvedValue({
      id: 1,
      senha_hash: await argon2.hash("certa"),
    });

    await expect(
      authService.login({ email: "bia@exemplo.com", senha: "errada" })
    ).rejects.toThrow("Email ou senha inválidos");
  });

  describe("migração do hash de bcrypt para argon2 no login", () => {
    const usuarioComHashBcrypt = (senha_hash) => ({
      id: 1,
      nome: "Bia",
      email: "bia@exemplo.com",
      role: "gestor",
      senha_hash,
      update: vi.fn(async (dados) => Object.assign({}, dados)),
    });

    it("aceita a senha com hash antigo (bcrypt) e regrava o hash em argon2", async () => {
      const usuario = usuarioComHashBcrypt(await bcrypt.hash("1234", 10));
      Usuario.findOne.mockResolvedValue(usuario);

      const resultado = await authService.login({ email: "bia@exemplo.com", senha: "1234" });

      expect(resultado.usuario.id).toBe(1);
      expect(usuario.update).toHaveBeenCalledTimes(1);
      const novoHash = usuario.update.mock.calls[0][0].senha_hash;
      expect(novoHash).toMatch(/^\$argon2/);
      expect(await argon2.verify(novoHash, "1234")).toBe(true);
    });

    it("rejeita senha errada com hash antigo (bcrypt) sem migrar o hash", async () => {
      const usuario = usuarioComHashBcrypt(await bcrypt.hash("certa", 10));
      Usuario.findOne.mockResolvedValue(usuario);

      await expect(
        authService.login({ email: "bia@exemplo.com", senha: "errada" })
      ).rejects.toMatchObject({ name: "AutenticacaoError" });
      expect(usuario.update).not.toHaveBeenCalled();
    });

    it("conclui o login mesmo se a migração do hash falhar ao gravar", async () => {
      const usuario = usuarioComHashBcrypt(await bcrypt.hash("1234", 10));
      usuario.update.mockRejectedValue(new Error("banco fora"));
      Usuario.findOne.mockResolvedValue(usuario);

      const resultado = await authService.login({ email: "bia@exemplo.com", senha: "1234" });

      expect(resultado.usuario.id).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        "Falha ao migrar hash de senha para Argon2:",
        "banco fora"
      );
    });
  });

  describe("tempo de resposta não revela se o e-mail existe", () => {
    it("confere a senha contra um hash fictício quando o usuário não existe", async () => {
      const verifySpy = vi.spyOn(argon2, "verify");
      Usuario.findOne.mockResolvedValue(null);

      await expect(
        authService.login({ email: "fantasma@exemplo.com", senha: "qualquer" })
      ).rejects.toMatchObject({ name: "AutenticacaoError" });

      expect(verifySpy).toHaveBeenCalledTimes(1);
      const [hashUsado] = verifySpy.mock.calls[0];
      expect(hashUsado).toMatch(/^\$argon2/);
      verifySpy.mockRestore();
    });
  });
});

describe("middleware autenticar", () => {
  it("aceita token válido e coloca o usuário na requisição", () => {
    const token = jwt.sign({ id: 1, role: "admin" }, SEGREDO);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = criarRes();
    const next = vi.fn();

    autenticar(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.usuario).toMatchObject({ id: 1, role: "admin" });
  });

  it("retorna 401 sem o cabeçalho Authorization", () => {
    const res = criarRes();
    const next = vi.fn();

    autenticar({ headers: {} }, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Token não informado" });
    expect(next).not.toHaveBeenCalled();
  });

  it("retorna 401 quando o formato não é Bearer", () => {
    const res = criarRes();
    const next = vi.fn();

    autenticar({ headers: { authorization: "Basic abc" } }, res, next);

    expect(res.json).toHaveBeenCalledWith({ mensagem: "Token inválido" });
    expect(next).not.toHaveBeenCalled();
  });

  it("retorna 401 para token assinado com outro segredo", () => {
    const token = jwt.sign({ id: 1 }, "outro-segredo");
    const res = criarRes();
    const next = vi.fn();

    autenticar({ headers: { authorization: `Bearer ${token}` } }, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Token inválido ou expirado" });
    expect(next).not.toHaveBeenCalled();
  });

  it("retorna 401 para token expirado", () => {
    const token = jwt.sign({ id: 1 }, SEGREDO, { expiresIn: -10 });
    const res = criarRes();
    const next = vi.fn();

    autenticar({ headers: { authorization: `Bearer ${token}` } }, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("middleware autenticar com logout", () => {
  const requisicaoCom = (token) => ({ headers: { authorization: `Bearer ${token}` } });

  it("recusa token encerrado pelo logout", async () => {
    TokenRevogado.findOne.mockResolvedValue({ id: 1 });
    const token = jwt.sign({ id: 1, role: "admin" }, SEGREDO, { jwtid: "abc" });
    const res = criarRes();
    const next = vi.fn();

    await autenticar(requisicaoCom(token), res, next);

    expect(TokenRevogado.findOne).toHaveBeenCalledWith({ attributes: ["id"], where: { jti: "abc" } });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Sessão encerrada" });
    expect(next).not.toHaveBeenCalled();
  });

  it("aceita token com id que não foi encerrado", async () => {
    TokenRevogado.findOne.mockResolvedValue(null);
    const token = jwt.sign({ id: 1, role: "admin" }, SEGREDO, { jwtid: "abc" });
    const req = requisicaoCom(token);
    const next = vi.fn();

    await autenticar(req, criarRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.usuario).toMatchObject({ id: 1, jti: "abc" });
  });

  it("aceita token antigo, sem id, sem consultar o banco", async () => {
    const token = jwt.sign({ id: 1, role: "admin" }, SEGREDO);
    const next = vi.fn();

    await autenticar(requisicaoCom(token), criarRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(TokenRevogado.findOne).not.toHaveBeenCalled();
  });

  it.each([
    ["sem conexão", new Sequelize.ConnectionRefusedError(new Error("ECONNREFUSED"))],
    ["com tempo esgotado", new Sequelize.ConnectionAcquireTimeoutError(new Error("timeout"))],
    ["com consulta demorada", new Sequelize.TimeoutError(new Error("timeout"))],
  ])("responde 503 quando o banco está %s", async (_, erro) => {
    TokenRevogado.findOne.mockRejectedValue(erro);
    const token = jwt.sign({ id: 1, role: "admin" }, SEGREDO, { jwtid: "abc" });
    const res = criarRes();
    const next = vi.fn();

    await autenticar(requisicaoCom(token), res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Banco de dados indisponível" });
    expect(next).not.toHaveBeenCalled();
  });

  it("responde 500 e registra o erro quando a falha não é de conexão", async () => {
    const erro = new TypeError("Cannot read properties of undefined (reading 'findOne')");
    TokenRevogado.findOne.mockRejectedValue(erro);
    const token = jwt.sign({ id: 1, role: "admin" }, SEGREDO, { jwtid: "abc" });
    const res = criarRes();
    const next = vi.fn();

    await autenticar(requisicaoCom(token), res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Erro interno do servidor" });
    expect(console.error).toHaveBeenCalledWith("Falha ao conferir o token revogado:", erro);
    expect(next).not.toHaveBeenCalled();
  });

  it("no logout, token já encerrado responde 204 sem passar adiante", async () => {
    TokenRevogado.findOne.mockResolvedValue({ id: 1 });
    const token = jwt.sign({ id: 1, role: "admin" }, SEGREDO, { jwtid: "abc" });
    const res = criarRes();
    res.send = vi.fn(() => res);
    const next = vi.fn();

    await autenticarLogout(requisicaoCom(token), res, next);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(next).not.toHaveBeenCalled();
  });

  it("no logout, token vencido pelo tempo responde 204 sem consultar o banco", async () => {
    const token = jwt.sign({ id: 1, role: "admin", exp: Math.floor(Date.now() / 1000) - 60 }, SEGREDO, {
      jwtid: "abc",
    });
    const res = criarRes();
    res.send = vi.fn(() => res);
    const next = vi.fn();

    await autenticarLogout(requisicaoCom(token), res, next);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(TokenRevogado.findOne).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("no logout, token com assinatura falsa continua respondendo 401", async () => {
    const token = jwt.sign({ id: 1, role: "admin" }, "outro-segredo", { jwtid: "abc" });
    const res = criarRes();
    const next = vi.fn();

    await autenticarLogout(requisicaoCom(token), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("fora do logout, token vencido continua respondendo 401", async () => {
    const token = jwt.sign({ id: 1, role: "admin", exp: Math.floor(Date.now() / 1000) - 60 }, SEGREDO);
    const res = criarRes();

    await autenticar(requisicaoCom(token), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Token inválido ou expirado" });
  });
});

describe("logout (authService)", () => {
  it("guarda o id do token até a hora em que ele expiraria e limpa os vencidos", async () => {
    await authService.logout({ id: 1, jti: "abc", exp: 1_900_000_000 });

    expect(TokenRevogado.bulkCreate).toHaveBeenCalledWith(
      [{ jti: "abc", expira_em: new Date(1_900_000_000 * 1000) }],
      { ignoreDuplicates: true }
    );
    expect(TokenRevogado.destroy).toHaveBeenCalledTimes(1);
  });

  it("não grava nada para token antigo sem id", async () => {
    await authService.logout({ id: 1, exp: 1_900_000_000 });

    expect(TokenRevogado.bulkCreate).not.toHaveBeenCalled();
  });

  it("encerra a sessão mesmo se a limpeza dos vencidos falhar", async () => {
    TokenRevogado.destroy.mockRejectedValue(new Error("banco lento"));

    await expect(authService.logout({ jti: "abc", exp: 1_900_000_000 })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("Falha ao limpar tokens revogados vencidos:", "banco lento");
  });
});

describe("middleware autorizar", () => {
  it("deixa passar quando o perfil é permitido", () => {
    const res = criarRes();
    const next = vi.fn();

    autorizar("admin", "gestor")({ usuario: { role: "gestor" } }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("retorna 403 quando o perfil não é permitido", () => {
    const res = criarRes();
    const next = vi.fn();

    autorizar("admin")({ usuario: { role: "fiscalizador" } }, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("retorna 401 quando não há usuário autenticado", () => {
    const res = criarRes();
    const next = vi.fn();

    autorizar("admin")({}, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("authController.login", () => {
  it("retorna 400 se email ou senha não forem fornecidos", async () => {
    const req = { body: {} };
    const res = criarRes();

    await authController.login(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Email e senha são obrigatórios",
    });
  });

  it("retorna 200 e o resultado quando o login for bem-sucedido", async () => {
    const req = { body: { email: "bia@exemplo.com", senha: "123" } };
    const res = criarRes();
    const tokenMock = { token: "abc", usuario: { id: 1 } };

    vi.spyOn(authService, "login").mockResolvedValueOnce(tokenMock);

    await authController.login(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(tokenMock);
  });

  it("retorna 401 quando o authService lança AutenticacaoError", async () => {
    const req = { body: { email: "errado@exemplo.com", senha: "errada" } };
    const res = criarRes();

    const erro = new Error("E-mail ou senha inválidos");
    erro.name = "AutenticacaoError";
    
    vi.spyOn(authService, "login").mockRejectedValueOnce(erro);

    await authController.login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "E-mail ou senha inválidos" });
  });

  it("retorna 500 quando ocorre um erro genérico/inesperado", async () => {
    const req = { body: { email: "bia@exemplo.com", senha: "123" } };
    const res = criarRes();

    vi.spyOn(authService, "login").mockRejectedValueOnce(
      Object.assign(new Error("Cadastro aguardando aprovação de um administrador"), {
        name: "CadastroPendenteError",
      })
    );

    await authController.login(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Cadastro aguardando aprovação de um administrador",
    });

    vi.clearAllMocks();
    vi.spyOn(authService, "login").mockRejectedValueOnce(new Error("Erro de banco"));

    await authController.login(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Erro ao realizar login",
    });
  });
});