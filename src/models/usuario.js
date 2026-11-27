import { campoTextoOpcional } from "../utils/index.js";

const getUsuarioModel = (sequelize, { DataTypes }) => {
  const Usuario = sequelize.define(
    "usuario",
    {
      nome: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notEmpty: true,
        },
      },
      email: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: false,
        validate: {
          isEmail: true,
        },
      },
      // Impressa no documento ao lado da assinatura do fiscal.
      ...campoTextoOpcional(DataTypes, "matricula", "Matrícula"),
      senha_hash: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      role: {
        type: DataTypes.ENUM("admin", "gestor", "fiscalizador"),
        allowNull: false,
        validate: {
          isIn: {
            args: [["admin", "gestor", "fiscalizador"]],
            msg: "Role deve ser admin, gestor ou fiscalizador",
          },
        },
      },
      aprovado: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: "usuarios",
      underscored: true,
    }
  );

  Usuario.associate = (models) => {
    Usuario.hasMany(models.Visita, {
      foreignKey: "gestor_id",
      as: "visitasGerenciadas",
      onDelete: "RESTRICT",
    });

    Usuario.belongsToMany(models.Visita, {
      through: models.VisitaFiscalizador,
      foreignKey: "fiscalizador_id",
      otherKey: "visita_id",
      as: "visitasFiscalizadas",
    });

    Usuario.hasMany(models.RefreshToken, {
      foreignKey: "usuario_id",
      as: "refreshTokens",
      onDelete: "CASCADE",
    });
  };

  return Usuario;
};

export default getUsuarioModel;