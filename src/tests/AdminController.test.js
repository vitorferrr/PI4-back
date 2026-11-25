import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import adminRoutes from "../routes/adminRoutes.js";
import adminService from "../services/adminService.js";

vi.mock("../services/authService.js", () => ({ default: { tokenRevogado: vi.fn(async () => false) } }));
vi.mock("../services/adminService.js", () => ({
  default: {
    obterDadosGerais: vi.fn(),
    exportarVisitasCsv: vi.fn(),
  },
}));

const SEGREDO = "segredo-de-teste";

let servidor;
let urlBase;

const tokenDe = (role, id = 1) => jwt.sign({ id, role }, SEGREDO);

const requisitar = (caminho, role) =>
  fetch(`${urlBase}${caminho}`, {
    method: "GET",
    headers: {
      ...(role && { Authorization: `Bearer ${tokenDe(role)}` }),
    },
  });

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", SEGREDO);

  const app = express();
  app.use(express.json());
  app.use("/admin", adminRoutes);

  await new Promise((resolve) => {
    servidor = app.listen(0, resolve);
  });
  urlBase = `http://127.0.0.1:${servidor.address().port}/admin`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => servidor.close(resolve));
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /admin/dados-gerais", () => {
  const resumoFalso = {
    visitas: {
      total: 10,
      por_status: {
        agendada: 3,
        em_andamento: 2,
        concluida: 4,
        cancelada: 1,
      },
    },
    usuarios: {
      total: 6,
      por_role: {
        admin: 1,
        gestor: 2,
        fiscalizador: 3,
      },
    },
    documentos: { total: 4 },
    assinaturas: { total: 8 },
  };

  it("retorna 200 com os dados gerais para admin", async () => {
    adminService.obterDadosGerais.mockResolvedValue(resumoFalso);

    const resposta = await requisitar("/dados-gerais", "admin");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual(resumoFalso);
    expect(adminService.obterDadosGerais).toHaveBeenCalledTimes(1);
  });

  it.each(["gestor", "fiscalizador"])(
    "responde 403 para %s sem chamar o service",
    async (role) => {
      const resposta = await requisitar("/dados-gerais", role);

      expect(resposta.status).toBe(403);
      expect(await resposta.json()).toEqual({
        mensagem: "Usuário não possui permissão para acessar este recurso",
      });
      expect(adminService.obterDadosGerais).not.toHaveBeenCalled();
    }
  );

  it("responde 401 sem token e não chama o service", async () => {
    const resposta = await requisitar("/dados-gerais");

    expect(resposta.status).toBe(401);
    expect(adminService.obterDadosGerais).not.toHaveBeenCalled();
  });

  it("responde 500 quando o service falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    adminService.obterDadosGerais.mockRejectedValue(new Error("falha no banco"));

    const resposta = await requisitar("/dados-gerais", "admin");

    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({
      mensagem: "Erro ao obter dados gerais",
    });
    consoleError.mockRestore();
  });
});

describe("GET /admin/exportar", () => {
  it("retorna 200 com CSV, cabeçalhos de download e metadados de total/truncamento para admin", async () => {
    const csvFalso = "id,denunciado\r\n1,Loja A";
    adminService.exportarVisitasCsv.mockResolvedValue({
      csv: csvFalso,
      total: 10,
      truncado: true,
    });

    const resposta = await requisitar(
      "/exportar?status=concluida&gestor_id=2&fiscalizador_id=5",
      "admin"
    );

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toContain("text/csv");
    expect(resposta.headers.get("content-disposition")).toBe(
      'attachment; filename="visitas.csv"'
    );
    expect(resposta.headers.get("x-total-count")).toBe("10");
    expect(resposta.headers.get("x-truncated")).toBe("true");
    expect(await resposta.text()).toBe(csvFalso);
    expect(adminService.exportarVisitasCsv).toHaveBeenCalledWith({
      status: "concluida",
      gestor_id: "2",
      fiscalizador_id: "5",
      limit: undefined,
      offset: undefined,
    });
  });

  it("responde 400 para filtros inválidos na query sem chamar o service", async () => {
    const resposta = await requisitar("/exportar?status=invalido", "admin");

    expect(resposta.status).toBe(400);
    expect(adminService.exportarVisitasCsv).not.toHaveBeenCalled();
  });

  it.each(["gestor", "fiscalizador"])(
    "responde 403 para %s sem chamar o service",
    async (role) => {
      const resposta = await requisitar("/exportar", role);

      expect(resposta.status).toBe(403);
      expect(adminService.exportarVisitasCsv).not.toHaveBeenCalled();
    }
  );

  it("responde 401 sem token e não chama o service", async () => {
    const resposta = await requisitar("/exportar");

    expect(resposta.status).toBe(401);
    expect(adminService.exportarVisitasCsv).not.toHaveBeenCalled();
  });

  it("responde 500 quando o service falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    adminService.exportarVisitasCsv.mockRejectedValue(new Error("falha"));

    const resposta = await requisitar("/exportar", "admin");

    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({
      mensagem: "Erro ao exportar visitas",
    });
    consoleError.mockRestore();
  });
});
