import { beforeEach, describe, expect, it, vi } from "vitest";
import argon2 from "argon2";
import gerarHashSenha from "../utils/hashSenha.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Sequelize from "sequelize";
import models from "../models/index.js";
import authService from "../services/authService.js";
import authController from "../controllers/authController.js";
import autenticar, { autenticarLogout } from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";
import errorHandler from "../middlewares/errorHandler.js";
import AppError from "../utils/appError.js";

vi.mock("../models/index.js", () => ({
  default: {
    Usuario: {
      findOne: vi.fn(),
      findByPk: vi.fn(),
    },
    TokenRevogado: {
      findOne: vi.fn(),
      bulkCreate: vi.fn(),
      destroy: vi.fn(),
    },
    RefreshToken: {
      create: vi.fn(),
      findOne: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const { RefreshToken, TokenRevogado, Usuario } = models;
const SEGREDO = "segredo-de-teste";

const criarRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

// next() de mentira que faz o que o Express faz: se o middleware chamar
// next(erro), o erro vai para o errorHandler, que monta a resposta em res.
const encaminharErro = (res) =>
  vi.fn((erro) => {
    if (erro) errorHandler(erro, {}, res, () => {});
  });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = SEGREDO;
  vi.spyOn(console, "error").mockImplementation(() => {});
  RefreshToken.create.mockResolvedValue({ id: 1 });
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
    expect(payload.exp - payload.iat).toBe(900);
    expect(resultado.usuario).toEqual({
      id: 1,
      nome: "Bia",
      email: "bia@exemplo.com",
      role: "gestor",
    });
    expect(resultado.refreshToken).toMatch(/^[\w-]{40,}$/);
    expect(RefreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({ usuario_id: 1 })
    );
  });

  it("procura o email sem espaços e em minúsculas", async () => {
    Usuario.findOne.mockResolvedValue(null);

    await expect(
      authService.login({ email: "  Bia@Exemplo.COM ", senha: "1234" })
    ).rejects.toMatchObject({ statusCode: 401 });

    expect(Usuario.findOne).toHaveBeenCalledWith({ where: { email: "bia@exemplo.com" } });
  });

  it.each([[123], [["bia@exemplo.com"]], ["   "]])(
    "rejeita email que não é texto preenchido (%o) sem consultar o banco",
    async (email) => {
      await expect(authService.login({ email, senha: "1234" })).rejects.toMatchObject({
        statusCode: 401,
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
    ).rejects.toMatchObject({ statusCode: 401 });
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
      statusCode: 403,
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
    ).rejects.toMatchObject({ statusCode: 401 });
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
      ).rejects.toMatchObject({ statusCode: 401, message: "Email ou senha inválidos" });
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

  describe("revisão da PR: falhas do Argon2 no log e hash fictício", () => {
    const parametros = (hash) => hash.split("$").slice(1, 4).join("$");

    it("o hash fictício usa os mesmos parâmetros (versão, m, t, p) da função que gera o hash das senhas reais", async () => {
      const verifySpy = vi.spyOn(argon2, "verify");
      Usuario.findOne.mockResolvedValue(null);

      await expect(
        authService.login({ email: "fantasma@exemplo.com", senha: "qualquer" })
      ).rejects.toMatchObject({ statusCode: 401 });

      const [hashFicticio] = verifySpy.mock.calls[0];
      const hashReal = await gerarHashSenha("uma-senha-de-verdade");
      expect(parametros(hashFicticio)).toBe(parametros(hashReal));
      verifySpy.mockRestore();
    });

    it("falha do argon2.verify ainda responde 401, mas registra no log", async () => {
      const usuario = { id: 1, senha_hash: await argon2.hash("certa"), update: vi.fn() };
      Usuario.findOne.mockResolvedValue(usuario);
      const verifySpy = vi.spyOn(argon2, "verify").mockRejectedValueOnce(new Error("sem memória"));

      await expect(authService.login({ email: "bia@exemplo.com", senha: "certa" })).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(console.error).toHaveBeenCalledWith("Falha ao verificar senha:", "sem memória");
      verifySpy.mockRestore();
    });

    it("falha do bcrypt.compare no hash antigo responde 401, registra no log e não migra", async () => {
      const usuario = { id: 1, senha_hash: await bcrypt.hash("certa", 4), update: vi.fn() };
      Usuario.findOne.mockResolvedValue(usuario);
      const compareSpy = vi.spyOn(bcrypt, "compare").mockRejectedValueOnce(new Error("hash corrompido"));

      await expect(authService.login({ email: "bia@exemplo.com", senha: "certa" })).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(console.error).toHaveBeenCalledWith("Falha ao verificar senha:", "hash corrompido");
      expect(usuario.update).not.toHaveBeenCalled();
      compareSpy.mockRestore();
    });
  });

  describe("tempo de resposta não revela se o e-mail existe", () => {
    it("confere a senha contra um hash fictício quando o usuário não existe", async () => {
      const verifySpy = vi.spyOn(argon2, "verify");
      Usuario.findOne.mockResolvedValue(null);

      await expect(
        authService.login({ email: "fantasma@exemplo.com", senha: "qualquer" })
      ).rejects.toMatchObject({ statusCode: 401, message: "Email ou senha inválidos" });

      expect(verifySpy).toHaveBeenCalledTimes(1);
      const [hashUsado] = verifySpy.mock.calls[0];
      expect(hashUsado).toMatch(/^\$argon2/);
      verifySpy.mockRestore();
    });
  });
});

describe("refresh (authService)", () => {
  const SEGREDOS_HASH = /^[0-9a-f]{64}$/;

  it("troca um refresh token válido por um novo par e marca o antigo como usado", async () => {
    RefreshToken.findOne.mockResolvedValue({
      id: 10,
      usuario_id: 1,
      usado_em: null,
      revogado_em: null,
      expira_em: new Date(Date.now() + 1000 * 60 * 60),
      update: vi.fn().mockResolvedValue(),
    });
    Usuario.findByPk.mockResolvedValue({ id: 1, nome: "Bia", email: "bia@exemplo.com", role: "gestor" });

    const resultado = await authService.refresh("token-recebido-do-cliente");

    const [{ where }] = RefreshToken.findOne.mock.calls[0];
    expect(where.token_hash).toMatch(SEGREDOS_HASH);
    const registro = await RefreshToken.findOne.mock.results[0].value;
    expect(registro.update).toHaveBeenCalledWith({ usado_em: expect.any(Date) });
    expect(resultado.usuario).toEqual({ id: 1, nome: "Bia", email: "bia@exemplo.com", role: "gestor" });
    expect(resultado.refreshToken).not.toBe("token-recebido-do-cliente");
  });

  it("rejeita token inexistente, vazio ou que não é texto, sem consultar o banco quando vazio", async () => {
    for (const valor of [undefined, "", "   ", 123]) {
      await expect(authService.refresh(valor)).rejects.toMatchObject({ statusCode: 401, message: "Sessão expirada. Faça login novamente." });
    }
    expect(RefreshToken.findOne).not.toHaveBeenCalled();

    RefreshToken.findOne.mockResolvedValue(null);
    await expect(authService.refresh("token-desconhecido")).rejects.toMatchObject({
      statusCode: 401, message: "Sessão expirada. Faça login novamente.",
    });
  });

  it("rejeita token vencido", async () => {
    RefreshToken.findOne.mockResolvedValue({
      usuario_id: 1,
      usado_em: null,
      revogado_em: null,
      expira_em: new Date(Date.now() - 1000),
      update: vi.fn(),
    });

    await expect(authService.refresh("token-vencido")).rejects.toMatchObject({
      statusCode: 401, message: "Sessão expirada. Faça login novamente.",
    });
  });

  it("recusa um refresh token já usado e revoga toda a sessão do usuário (reuso = possível roubo)", async () => {
    RefreshToken.findOne.mockResolvedValue({
      usuario_id: 1,
      usado_em: new Date(),
      revogado_em: null,
      expira_em: new Date(Date.now() + 1000 * 60 * 60),
      update: vi.fn(),
    });

    await expect(authService.refresh("token-reusado")).rejects.toMatchObject({
      statusCode: 401, message: "Sessão expirada. Faça login novamente.",
    });

    expect(RefreshToken.update).toHaveBeenCalledWith(
      { revogado_em: expect.any(Date) },
      { where: { usuario_id: 1, usado_em: null, revogado_em: null } }
    );
  });

  it("recusa um refresh token já revogado", async () => {
    RefreshToken.findOne.mockResolvedValue({
      usuario_id: 1,
      usado_em: null,
      revogado_em: new Date(),
      expira_em: new Date(Date.now() + 1000 * 60 * 60),
      update: vi.fn(),
    });

    await expect(authService.refresh("token-revogado")).rejects.toMatchObject({
      statusCode: 401, message: "Sessão expirada. Faça login novamente.",
    });
  });

  it("rejeita quando o usuário do token não existe mais", async () => {
    RefreshToken.findOne.mockResolvedValue({
      usuario_id: 99,
      usado_em: null,
      revogado_em: null,
      expira_em: new Date(Date.now() + 1000 * 60 * 60),
      update: vi.fn(),
    });
    Usuario.findByPk.mockResolvedValue(null);

    await expect(authService.refresh("token-de-usuario-removido")).rejects.toMatchObject({
      statusCode: 401, message: "Sessão expirada. Faça login novamente.",
    });
  });

  it("bloqueia e revoga o token de cadastro ainda não aprovado", async () => {
    const registro = {
      usuario_id: 1,
      usado_em: null,
      revogado_em: null,
      expira_em: new Date(Date.now() + 1000 * 60 * 60),
      update: vi.fn().mockResolvedValue(),
    };
    RefreshToken.findOne.mockResolvedValue(registro);
    Usuario.findByPk.mockResolvedValue({ id: 1, aprovado: false });

    await expect(authService.refresh("token-pendente")).rejects.toMatchObject({
      statusCode: 403, message: "Cadastro aguardando aprovação de um administrador",
    });
    expect(registro.update).toHaveBeenCalledWith({ revogado_em: expect.any(Date) });
  });
});

describe("middleware autenticar", () => {
  it("aceita token válido e coloca o usuário na requisição", () => {
    const token = jwt.sign({ id: 1, role: "admin" }, SEGREDO);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = criarRes();
    const next = encaminharErro(res);

    autenticar(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.usuario).toMatchObject({ id: 1, role: "admin" });
  });

  it("retorna 401 sem o cabeçalho Authorization", () => {
    const res = criarRes();
    const next = encaminharErro(res);

    autenticar({ headers: {} }, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Token não informado" });
    expect(next).not.toHaveBeenCalledWith();
  });

  it("retorna 401 quando o formato não é Bearer", () => {
    const res = criarRes();
    const next = encaminharErro(res);

    autenticar({ headers: { authorization: "Basic abc" } }, res, next);

    expect(res.json).toHaveBeenCalledWith({ mensagem: "Token inválido" });
    expect(next).not.toHaveBeenCalledWith();
  });

  it("retorna 401 para token assinado com outro segredo", () => {
    const token = jwt.sign({ id: 1 }, "outro-segredo");
    const res = criarRes();
    const next = encaminharErro(res);

    autenticar({ headers: { authorization: `Bearer ${token}` } }, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Token inválido ou expirado" });
    expect(next).not.toHaveBeenCalledWith();
  });

  it("retorna 401 para token expirado", () => {
    const token = jwt.sign({ id: 1 }, SEGREDO, { expiresIn: -10 });
    const res = criarRes();
    const next = encaminharErro(res);

    autenticar({ headers: { authorization: `Bearer ${token}` } }, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalledWith();
  });
});

describe("middleware autenticar com logout", () => {
  const requisicaoCom = (token) => ({ headers: { authorization: `Bearer ${token}` } });

  it("recusa token encerrado pelo logout", async () => {
    TokenRevogado.findOne.mockResolvedValue({ id: 1 });
    const token = jwt.sign({ id: 1, role: "admin" }, SEGREDO, { jwtid: "abc" });
    const res = criarRes();
    const next = encaminharErro(res);

    await autenticar(requisicaoCom(token), res, next);

    expect(TokenRevogado.findOne).toHaveBeenCalledWith({ attributes: ["id"], where: { jti: "abc" } });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Sessão encerrada" });
    expect(next).not.toHaveBeenCalledWith();
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
    const next = encaminharErro(res);

    await autenticar(requisicaoCom(token), res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Banco de dados indisponível" });
    expect(next).not.toHaveBeenCalledWith();
  });

  it("responde 500 e registra o erro quando a falha não é de conexão", async () => {
    const erro = new TypeError("Cannot read properties of undefined (reading 'findOne')");
    TokenRevogado.findOne.mockRejectedValue(erro);
    const token = jwt.sign({ id: 1, role: "admin" }, SEGREDO, { jwtid: "abc" });
    const res = criarRes();
    const next = encaminharErro(res);

    await autenticar(requisicaoCom(token), res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Erro interno do servidor" });
    expect(console.error).toHaveBeenCalledWith("Falha ao conferir o token revogado:", erro);
    expect(next).not.toHaveBeenCalledWith();
  });

  // DT-38: no logout o pedido segue para o controller mesmo com o access token já
  // encerrado ou vencido, para revogar o refresh token enviado no corpo.
  it("no logout, token já encerrado segue para o controller, sem consultar a lista de revogados", async () => {
    TokenRevogado.findOne.mockResolvedValue({ id: 1 });
    const token = jwt.sign({ id: 1, role: "admin" }, SEGREDO, { jwtid: "abc" });
    const req = requisicaoCom(token);
    const res = criarRes();
    const next = vi.fn();

    await autenticarLogout(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(TokenRevogado.findOne).not.toHaveBeenCalled();
    expect(req.usuario).toMatchObject({ id: 1, jti: "abc" });
  });

  it("no logout, token vencido pelo tempo segue para o controller com o usuário do token", async () => {
    const token = jwt.sign({ id: 1, role: "admin", exp: Math.floor(Date.now() / 1000) - 60 }, SEGREDO, {
      jwtid: "abc",
    });
    const req = requisicaoCom(token);
    const res = criarRes();
    const next = vi.fn();

    await autenticarLogout(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(TokenRevogado.findOne).not.toHaveBeenCalled();
    expect(req.usuario).toMatchObject({ id: 1, role: "admin" });
  });

  it("no logout, token vencido com assinatura falsa continua respondendo 401", async () => {
    const token = jwt.sign({ id: 1, role: "admin", exp: Math.floor(Date.now() / 1000) - 60 }, "outro-segredo");
    const res = criarRes();
    const next = encaminharErro(res);

    await autenticarLogout(requisicaoCom(token), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Token inválido ou expirado" });
    expect(next).not.toHaveBeenCalledWith();
  });

  it("no logout, token com assinatura falsa continua respondendo 401", async () => {
    const token = jwt.sign({ id: 1, role: "admin" }, "outro-segredo", { jwtid: "abc" });
    const res = criarRes();
    const next = encaminharErro(res);

    await autenticarLogout(requisicaoCom(token), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalledWith();
  });

  it("fora do logout, token vencido continua respondendo 401", async () => {
    const token = jwt.sign({ id: 1, role: "admin", exp: Math.floor(Date.now() / 1000) - 60 }, SEGREDO);
    const res = criarRes();

    await autenticar(requisicaoCom(token), res, encaminharErro(res));

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

  it("revoga o refresh token informado", async () => {
    await authService.logout({ jti: "abc", exp: 1_900_000_000 }, "refresh-do-cliente");

    expect(RefreshToken.update).toHaveBeenCalledWith(
      { revogado_em: expect.any(Date) },
      {
        where: {
          token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
          usado_em: null,
          revogado_em: null,
        },
      }
    );
  });

  it("só revoga refresh token do próprio usuário do access token", async () => {
    await authService.logout({ id: 7, jti: "abc", exp: 1_900_000_000 }, "refresh-do-cliente");

    expect(RefreshToken.update).toHaveBeenCalledWith(
      { revogado_em: expect.any(Date) },
      { where: expect.objectContaining({ usuario_id: 7 }) }
    );
  });

  it("token já vencido não entra na lista de revogados, mas o refresh é revogado", async () => {
    const venceuHaUmMinuto = Math.floor(Date.now() / 1000) - 60;

    await authService.logout({ id: 7, jti: "abc", exp: venceuHaUmMinuto }, "refresh-do-cliente");

    expect(TokenRevogado.bulkCreate).not.toHaveBeenCalled();
    expect(RefreshToken.update).toHaveBeenCalledTimes(1);
  });

  it("não chama o RefreshToken quando nenhum refresh token é informado", async () => {
    await authService.logout({ jti: "abc", exp: 1_900_000_000 });

    expect(RefreshToken.update).not.toHaveBeenCalled();
  });
});

describe("middleware autorizar", () => {
  it("deixa passar quando o perfil é permitido", () => {
    const res = criarRes();
    const next = encaminharErro(res);

    autorizar("admin", "gestor")({ usuario: { role: "gestor" } }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("retorna 403 quando o perfil não é permitido", () => {
    const res = criarRes();
    const next = encaminharErro(res);

    autorizar("admin")({ usuario: { role: "fiscalizador" } }, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalledWith();
  });

  it("retorna 401 quando não há usuário autenticado", () => {
    const res = criarRes();
    const next = encaminharErro(res);

    autorizar("admin")({}, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalledWith();
  });
});

describe("authController.login", () => {
  it("retorna 200 e o resultado quando o login for bem-sucedido", async () => {
    const req = { body: { email: "bia@exemplo.com", senha: "123" } };
    const res = criarRes();
    const tokenMock = { token: "abc", usuario: { id: 1 } };

    vi.spyOn(authService, "login").mockResolvedValueOnce(tokenMock);

    await authController.login(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(tokenMock);
  });

  it("deixa o erro do authService subir para o middleware global de erro", async () => {
    const req = { body: { email: "errado@exemplo.com", senha: "errada" } };
    const res = criarRes();
    const erro = new Error("Erro de banco");

    vi.spyOn(authService, "login").mockRejectedValueOnce(erro);

    await expect(authController.login(req, res)).rejects.toBe(erro);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("authController.refresh", () => {
  it("retorna 200 e o novo par de tokens quando a troca é bem-sucedida", async () => {
    const req = { body: { refreshToken: "refresh-valido" } };
    const res = criarRes();
    const novoPar = { token: "novo-access", refreshToken: "novo-refresh", usuario: { id: 1 } };

    vi.spyOn(authService, "refresh").mockResolvedValueOnce(novoPar);

    await authController.refresh(req, res);

    expect(authService.refresh).toHaveBeenCalledWith("refresh-valido");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(novoPar);
  });

  it("deixa o erro do authService subir para o middleware global de erro", async () => {
    const req = { body: { refreshToken: "refresh-invalido" } };
    const res = criarRes();
    const erro = new AppError("Sessão expirada. Faça login novamente.", 401);

    vi.spyOn(authService, "refresh").mockRejectedValueOnce(erro);

    await expect(authController.refresh(req, res)).rejects.toBe(erro);
    expect(res.status).not.toHaveBeenCalled();
  });
});
