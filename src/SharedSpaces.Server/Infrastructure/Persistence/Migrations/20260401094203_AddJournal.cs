using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SharedSpaces.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddJournal : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "JournalPrunedBefore",
                table: "Spaces",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastSyncAt",
                table: "SpaceMembers",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "DeletedItems",
                columns: table => new
                {
                    ItemId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SpaceId = table.Column<Guid>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DeletedItems", x => x.ItemId);
                    table.ForeignKey(
                        name: "FK_DeletedItems_Spaces_SpaceId",
                        column: x => x.SpaceId,
                        principalTable: "Spaces",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DeletedItems_SpaceId_DeletedAt",
                table: "DeletedItems",
                columns: new[] { "SpaceId", "DeletedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DeletedItems");

            migrationBuilder.DropColumn(
                name: "JournalPrunedBefore",
                table: "Spaces");

            migrationBuilder.DropColumn(
                name: "LastSyncAt",
                table: "SpaceMembers");
        }
    }
}
