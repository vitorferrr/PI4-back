const getTokenRevogadoModel = (sequelize, { DataTypes }) =>
  sequelize.define(
    "token_revogado",
    {
      jti: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      expira_em: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      tableName: "tokens_revogados",
      underscored: true,
      updatedAt: false,
      indexes: [{ fields: ["expira_em"] }],
    }
  );

export default getTokenRevogadoModel;
