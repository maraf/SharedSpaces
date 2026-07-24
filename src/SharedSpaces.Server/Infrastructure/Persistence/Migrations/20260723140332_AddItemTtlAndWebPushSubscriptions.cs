using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SharedSpaces.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddItemTtlAndWebPushSubscriptions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "TtlSeconds",
                table: "SpaceItems",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "WebPushSubscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    SpaceId = table.Column<Guid>(type: "TEXT", nullable: false),
                    MemberId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Endpoint = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: false),
                    P256Dh = table.Column<string>(type: "TEXT", maxLength: 256, nullable: false),
                    Auth = table.Column<string>(type: "TEXT", maxLength: 256, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WebPushSubscriptions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WebPushSubscriptions_SpaceMembers_MemberId",
                        column: x => x.MemberId,
                        principalTable: "SpaceMembers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_WebPushSubscriptions_Spaces_SpaceId",
                        column: x => x.SpaceId,
                        principalTable: "Spaces",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WebPushSubscriptions_MemberId",
                table: "WebPushSubscriptions",
                column: "MemberId");

            migrationBuilder.CreateIndex(
                name: "IX_WebPushSubscriptions_SpaceId",
                table: "WebPushSubscriptions",
                column: "SpaceId");

            migrationBuilder.CreateIndex(
                name: "IX_WebPushSubscriptions_SpaceId_MemberId_Endpoint",
                table: "WebPushSubscriptions",
                columns: new[] { "SpaceId", "MemberId", "Endpoint" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WebPushSubscriptions");

            migrationBuilder.DropColumn(
                name: "TtlSeconds",
                table: "SpaceItems");
        }
    }
}
