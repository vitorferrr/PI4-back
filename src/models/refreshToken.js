const getRefreshTokenModel = (sequelize, { DataTypes }) => {
  const RefreshToken = sequelize.define(
    "refresh_token",
    {
      usuario_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "usuarios",
          key: "id",
        },
      },
      token_hash: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      expira_em: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      usado_em: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      revogado_em: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "refresh_tokens",
      underscored: true,
      updatedAt: false,
      indexes: [{ fields: ["usuario_id"] }],
    }
  );

  RefreshToken.associate = (models) => {
    RefreshToken.belongsTo(models.Usuario, {
      foreignKey: "usuario_id",
      as: "usuario",
      onDelete: "CASCADE",
    });
  };

  return RefreshToken;
};

export default getRefreshTokenModel;
