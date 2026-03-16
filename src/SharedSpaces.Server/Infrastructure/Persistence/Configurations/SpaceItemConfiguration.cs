using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SharedSpaces.Server.Domain;

namespace SharedSpaces.Server.Infrastructure.Persistence.Configurations;

public class SpaceItemConfiguration : IEntityTypeConfiguration<SpaceItem>
{
    public void Configure(EntityTypeBuilder<SpaceItem> builder)
    {
        builder.ToTable("SpaceItems");

        builder.HasKey(item => item.Id);

        builder.Property(item => item.Id)
            .ValueGeneratedNever();

        builder.Property(item => item.ContentType)
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(item => item.Content)
            .IsRequired();

        builder.Property(item => item.SharedAt)
            .IsRequired();

        builder.HasIndex(item => new { item.SpaceId, item.SharedAt });
        builder.HasIndex(item => item.MemberId);

        builder.HasOne(item => item.Space)
            .WithMany(space => space.Items)
            .HasForeignKey(item => item.SpaceId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(item => item.Member)
            .WithMany(member => member.Items)
            .HasForeignKey(item => item.MemberId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
