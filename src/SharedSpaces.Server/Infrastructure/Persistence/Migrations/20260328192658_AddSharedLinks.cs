using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SharedSpaces.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSharedLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SpaceInvitations_Pin",
                table: "SpaceInvitations");

            migrationBuilder.CreateTable(
                name: "SharedLinks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Token = table.Column<Guid>(type: "TEXT", nullable: false),
                    SpaceId = table.Column<Guid>(type: "TEXT", nullable: false),
                    ItemId = table.Column<Guid>(type: "TEXT", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SharedLinks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SharedLinks_SpaceItems_ItemId",
                        column: x => x.ItemId,
                        principalTable: "SpaceItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SharedLinks_SpaceMembers_CreatedBy",
                        column: x => x.CreatedBy,
                        principalTable: "SpaceMembers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SharedLinks_Spaces_SpaceId",
                        column: x => x.SpaceId,
                        principalTable: "Spaces",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SpaceInvitations_Pin",
                table: "SpaceInvitations",
                column: "Pin",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SharedLinks_CreatedBy",
                table: "SharedLinks",
                column: "CreatedBy");

            migrationBuilder.CreateIndex(
                name: "IX_SharedLinks_ItemId",
                table: "SharedLinks",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_SharedLinks_SpaceId_ItemId",
                table: "SharedLinks",
                columns: new[] { "SpaceId", "ItemId" });

            migrationBuilder.CreateIndex(
                name: "IX_SharedLinks_Token",
                table: "SharedLinks",
                column: "Token",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SharedLinks");

            migrationBuilder.DropIndex(
                name: "IX_SpaceInvitations_Pin",
                table: "SpaceInvitations");

            migrationBuilder.CreateIndex(
                name: "IX_SpaceInvitations_Pin",
                table: "SpaceInvitations",
                column: "Pin");
        }
    }
}
