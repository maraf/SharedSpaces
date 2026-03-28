using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SharedSpaces.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPinIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_SpaceInvitations_Pin",
                table: "SpaceInvitations",
                column: "Pin");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SpaceInvitations_Pin",
                table: "SpaceInvitations");
        }
    }
}
