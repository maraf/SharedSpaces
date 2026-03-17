using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SharedSpaces.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSpaceItemFileSize : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "FileSize",
                table: "SpaceItems",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FileSize",
                table: "SpaceItems");
        }
    }
}
