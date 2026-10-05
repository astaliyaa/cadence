import SwiftUI

/// Apple Music–style flowing background: a 3×3 mesh gradient coloured from the
/// artwork, whose inner points drift slowly while music plays.
struct MeshBackground: View {
    let coverID: String?
    var animating: Bool

    @State private var colors: [Color] = Array(repeating: Color(white: 0.18), count: 9)

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !animating)) { context in
            let t = Float(context.date.timeIntervalSinceReferenceDate)
            MeshGradient(width: 3, height: 3, points: points(at: t), colors: colors, smoothsColors: true)
        }
        .overlay(Color.black.opacity(0.18))
        .ignoresSafeArea()
        .task(id: coverID) { await loadColors() }
    }

    private func points(at t: Float) -> [SIMD2<Float>] {
        let a = sin(t * 0.21) * 0.18, b = cos(t * 0.17) * 0.16, c = sin(t * 0.13 + 1) * 0.12
        return [
            [0, 0], [0.5 + c, 0], [1, 0],
            [0, 0.5 + b], [0.5 + a, 0.5 + b], [1, 0.5 - a],
            [0, 1], [0.5 - c, 1], [1, 1],
        ]
    }

    private func loadColors() async {
        guard let api = Session.shared.api, let url = api.coverURL(coverID, size: 160) else { return }
        guard let image = await ImageLoader.shared.image(for: url, maxPixel: 160) else { return }
        let grid = Palette.grid(from: image)
        guard grid.count == 9 else { return }
        withAnimation(.easeInOut(duration: 1.2)) { colors = grid }
    }
}
