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
      matricula: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          len: {
            args: [0, 255],
            msg: "Matrícula deve ter no máximo 255 caracteres",
          },
        },
      },
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
  };

  return Usuario;
};

export default getUsuarioModel;