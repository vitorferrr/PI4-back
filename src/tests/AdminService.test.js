import { beforeEach, describe, expect, it, vi } from "vitest";

const { Usuario, Visita, Documento, Assinatura } = vi.hoisted(() => ({
  Usuario: { count: vi.fn() },
  Visita: { count: vi.fn() },
  Documento: { count: vi.fn() },
  Assinatura: { count: vi.fn() },
}));

vi.mock("../models/index.js", () => ({
  default: { Usuario, Visita, Documento, Assinatura },
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
