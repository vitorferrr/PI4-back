import { beforeEach, describe, expect, it, vi } from "vitest";

const { Usuario, Visita, Documento, Assinatura, listarVisitas } = vi.hoisted(
  () => ({
    Usuario: { count: vi.fn() },
    Visita: { count: vi.fn() },
    Documento: { count: vi.fn() },
    Assinatura: { count: vi.fn() },
    listarVisitas: vi.fn(),
  })
);

vi.mock("../models/index.js", () => ({
  default: { Usuario, Visita, Documento, Assinatura },
}));

vi.mock("../services/visitaService.js", () => ({
  default: { listar: listarVisitas },
}));

import adminService from "../services/adminService.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("adminService.obterDadosGerais", () => {
  it("agrega os totais de visitas por status, usuários por perfil, documentos e assinaturas", async () => {
    Visita.count.mockImplementation(async ({ where }) => {
      const mapa = {
        agendada: 5,
        em_andamento: 2,
        concluida: 7,
        cancelada: 1,
      };
      return mapa[where.status];
    });

    Usuario.count.mockImplementation(async ({ where }) => {
      const mapa = {
        admin: 1,
        gestor: 3,
        fiscalizador: 6,
      };
      return mapa[where.role];
    });

    Documento.count.mockResolvedValue(7);
    Assinatura.count.mockResolvedValue(14);

    const resultado = await adminService.obterDadosGerais();

    expect(resultado).toEqual({
      visitas: {
        total: 15,
        por_status: {
          agendada: 5,
          em_andamento: 2,
          concluida: 7,
          cancelada: 1,
        },
      },
      usuarios: {
        total: 10,
        por_role: {
          admin: 1,
          gestor: 3,
          fiscalizador: 6,
        },
      },
      documentos: {
        total: 7,
      },
      assinaturas: {
        total: 14,
      },
    });
  });
});

describe("adminService.exportarVisitasCsv", () => {
  it("gera CSV com BOM, cabeçalho, campos escapados e filtros repassados", async () => {
    listarVisitas.mockResolvedValue([
      {
        id: 10,
        denunciado: 'Mercado "Bom, Preço"',
        status: "concluida",
        gestor: { nome: "Carlos" },
        fiscalizadores: [{ nome: "Ana" }, { nome: "Bruno" }],
        data_agendada: new Date("2026-12-01T10:00:00.000Z"),
        data_realizacao: null,
        latitude: "-23.55052000",
        longitude: "-46.63330800",
        observacoes_livres: "Linha 1\nLinha 2",
      },
    ]);

    const csv = await adminService.exportarVisitasCsv({ status: "concluida" });

    expect(listarVisitas).toHaveBeenCalledWith({ status: "concluida" });
    expect(csv).toBe(
      '\uFEFFid,denunciado,status,gestor,fiscalizadores,data_agendada,data_realizacao,latitude,longitude,observacoes_livres\r\n10,"Mercado ""Bom, Preço""",concluida,Carlos,Ana; Bruno,2026-12-01T10:00:00.000Z,,-23.55052000,-46.63330800,"Linha 1\nLinha 2"'
    );
  });

  it("gera apenas o cabeçalho quando não há visitas", async () => {
    listarVisitas.mockResolvedValue([]);

    const csv = await adminService.exportarVisitasCsv();

    expect(csv).toBe(
      "\uFEFFid,denunciado,status,gestor,fiscalizadores,data_agendada,data_realizacao,latitude,longitude,observacoes_livres"
    );
  });
});
