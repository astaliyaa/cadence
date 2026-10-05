import SwiftUI

/// Cover art for an album/artist/playlist id, loaded at a sharp size for its frame.
struct ArtworkView: View {
    let id: String?
    var size: CGFloat
    var cornerRadius: CGFloat = 6
    var circle = false
    /// Hero-sized artwork; loads the untouched original when quality is "Original".
    var large = false
    var placeholderSymbol = "music.note"

    @Environment(\.displayScale) private var displayScale
    @State private var image: UIImage?

    var body: some View {
        let url = coverURL
        ZStack {
            placeholder
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            }
        }
        .frame(width: size, height: size)
        .clipShape(shape)
        .overlay(shape.stroke(Color.primary.opacity(0.08), lineWidth: 0.5))
        .task(id: url) {
            guard let url else { image = nil; return }
            if let hit = ImageLoader.shared.cached(url) {
                image = hit
                return
            }
            let loaded = await ImageLoader.shared.image(for: url, maxPixel: size * displayScale * 2)
            withAnimation(.easeOut(duration: 0.25)) { image = loaded }
        }
    }

    private var shape: AnyShape {
        circle ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }

    private var coverURL: URL? {
        guard let api = Session.shared.api else { return nil }
        let quality = AppSettings.shared.artworkQuality
        if large && quality == .original { return api.coverURL(id, size: nil) }
        return api.coverURL(id, size: ArtSize.pixels(for: size, scale: displayScale, quality: quality))
    }

    private var placeholder: some View {
        ZStack {
            LinearGradient(colors: [Color(.systemGray4), Color(.systemGray5)], startPoint: .topLeading, endPoint: .bottomTrailing)
            Image(systemName: placeholderSymbol)
                .font(.system(size: max(12, size * 0.3), weight: .regular))
                .foregroundStyle(.secondary)
        }
    }
}

/// Same as ArtworkView but sized by its container (for grids).
struct FlexibleArtwork: View {
    let id: String?
    var cornerRadius: CGFloat = 8
    var circle = false
    var placeholderSymbol = "music.note"

    var body: some View {
        GeometryReader { geo in
            ArtworkView(id: id, size: geo.size.width, cornerRadius: cornerRadius, circle: circle, placeholderSymbol: placeholderSymbol)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}
