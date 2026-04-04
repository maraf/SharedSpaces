using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SharedSpaces.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddContentToDeletedItem : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Content",
                table: "DeletedItems",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Content",
                table: "DeletedItems");
        }
    }
}
